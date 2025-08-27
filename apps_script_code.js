// Google Apps Script for Lightbox Digital Admin System
// This script handles user authentication, user management, and email invitations

// Configuration - Update these values
const CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID', // Replace with your Google Sheets ID
  USERS_SHEET_NAME: 'Users',
  SESSIONS_SHEET_NAME: 'Sessions',
  ADMIN_EMAIL: 'your-admin-email@gmail.com', // Replace with your admin email
  SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
};

/**
 * Web app entry points
 */
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

/**
 * Main request handler
 */
function handleRequest(e) {
  try {
    const action = e.parameter.action;
    
    // Set CORS headers
    const output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JSON);
    
    let response;
    
    switch (action) {
      case 'login':
        response = handleLogin(e.parameter);
        break;
      case 'verifyToken':
        response = handleVerifyToken(e.parameter);
        break;
      case 'verifyTempLogin':
        response = handleVerifyTempLogin(e.parameter);
        break;
      case 'completeUserSetup':
        response = handleCompleteUserSetup(e.parameter);
        break;
      case 'getDashboardStats':
        response = handleGetDashboardStats(e.parameter);
        break;
      case 'getUsers':
        response = handleGetUsers(e.parameter);
        break;
      case 'addUser':
        response = handleAddUser(e.parameter);
        break;
      case 'deleteUser':
        response = handleDeleteUser(e.parameter);
        break;
      default:
        response = { success: false, message: 'Invalid action' };
    }
    
    output.setContent(JSON.stringify(response));
    return output;
    
  } catch (error) {
    console.error('Request handling error:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ 
        success: false, 
        message: 'Server error: ' + error.toString() 
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Initialize the spreadsheet with required sheets and headers
 */
function initializeSpreadsheet() {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    
    // Create Users sheet
    let usersSheet = spreadsheet.getSheetByName(CONFIG.USERS_SHEET_NAME);
    if (!usersSheet) {
      usersSheet = spreadsheet.insertSheet(CONFIG.USERS_SHEET_NAME);
      usersSheet.getRange(1, 1, 1, 8).setValues([[
        'Full Name', 'Email', 'Username', 'Password', 'Role', 'Status', 'Created Date', 'Notes'
      ]]);
      usersSheet.getRange(1, 1, 1, 8).setFontWeight('bold');
      
      // Add default admin user
      const adminPassword = generateRandomPassword();
      usersSheet.getRange(2, 1, 1, 8).setValues([[
        'Admin User',
        CONFIG.ADMIN_EMAIL,
        'admin',
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, adminPassword),
        'admin',
        'active',
        new Date(),
        'Default admin user'
      ]]);
      
      console.log('Default admin password:', adminPassword);
    }
    
    // Create Sessions sheet
    let sessionsSheet = spreadsheet.getSheetByName(CONFIG.SESSIONS_SHEET_NAME);
    if (!sessionsSheet) {
      sessionsSheet = spreadsheet.insertSheet(CONFIG.SESSIONS_SHEET_NAME);
      sessionsSheet.getRange(1, 1, 1, 4).setValues([[
        'Token', 'Username', 'Created Date', 'Expires Date'
      ]]);
      sessionsSheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    }
    
    return { success: true, message: 'Spreadsheet initialized successfully' };
    
  } catch (error) {
    console.error('Initialization error:', error);
    return { success: false, message: 'Failed to initialize spreadsheet: ' + error.toString() };
  }
}

/**
 * Handle user login
 */
function handleLogin(params) {
  try {
    const { username, password } = params;
    
    if (!username || !password) {
      return { success: false, message: 'Username and password are required' };
    }
    
    const user = findUser(username);
    if (!user) {
      return { success: false, message: 'Invalid username or password' };
    }
    
    // Verify password (assuming passwords are hashed)
    const hashedPassword = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
    const hashedPasswordStr = Utilities.base64Encode(hashedPassword);
    
    if (user.password !== hashedPasswordStr && user.password !== password) {
      return { success: false, message: 'Invalid username or password' };
    }
    
    if (user.status !== 'active') {
      return { success: false, message: 'Account is not active' };
    }
    
    // Create session token
    const token = generateSessionToken();
    saveSession(token, username);
    
    return { 
      success: true, 
      token: token,
      message: 'Login successful' 
    };
    
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, message: 'Login failed: ' + error.toString() };
  }
}

/**
 * Handle temporary login verification (for user setup)
 */
function handleVerifyTempLogin(params) {
  try {
    const { username, password } = params;
    
    if (!username || !password) {
      return { success: false, message: 'Username and password are required' };
    }
    
    const user = findUser(username);
    if (!user) {
      return { success: false, message: 'Invalid temporary credentials' };
    }
    
    // Verify password (check both hashed and plain text for temp passwords)
    const hashedPassword = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
    );
    
    if (user.password !== hashedPassword && user.password !== password) {
      return { success: false, message: 'Invalid temporary credentials' };
    }
    
    if (user.status !== 'pending') {
      return { success: false, message: 'Account setup already completed. Please use the normal login.' };
    }
    
    return { 
      success: true, 
      email: user.email,
      message: 'Temporary credentials verified' 
    };
    
  } catch (error) {
    console.error('Temp login verification error:', error);
    return { success: false, message: 'Verification failed: ' + error.toString() };
  }
}

/**
 * Handle user setup completion
 */
function handleCompleteUserSetup(params) {
  try {
    const { email, newUsername, newPassword } = params;
    
    if (!email || !newUsername || !newPassword) {
      return { success: false, message: 'All fields are required' };
    }
    
    // Validate password strength
    if (!isPasswordStrong(newPassword)) {
      return { success: false, message: 'Password does not meet security requirements' };
    }
    
    // Check if new username is already taken
    const existingUser = findUser(newUsername);
    if (existingUser && existingUser.email !== email) {
      return { success: false, message: 'Username already taken' };
    }
    
    // Find user by email
    const user = findUserByEmail(email);
    if (!user) {
      return { success: false, message: 'User not found' };
    }
    
    if (user.status !== 'pending') {
      return { success: false, message: 'Account setup already completed' };
    }
    
    // Update user with new credentials
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const usersSheet = spreadsheet.getSheetByName(CONFIG.USERS_SHEET_NAME);
    const data = usersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === email) { // Email is in column B (index 1)
        const hashedPassword = Utilities.base64Encode(
          Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, newPassword)
        );
        
        // Update username, password, and status
        usersSheet.getRange(i + 1, 3).setValue(newUsername); // Username column
        usersSheet.getRange(i + 1, 4).setValue(hashedPassword); // Password column
        usersSheet.getRange(i + 1, 6).setValue('active'); // Status column
        break;
      }
    }
    
    return { 
      success: true, 
      message: 'Account setup completed successfully' 
    };
    
  } catch (error) {
    console.error('User setup completion error:', error);
    return { success: false, message: 'Setup completion failed: ' + error.toString() };
  }
}

/**
 * Validate password strength
 */
function isPasswordStrong(password) {
  // At least 8 characters, one uppercase, one lowercase, one number
  return password.length >= 8 && 
         /[A-Z]/.test(password) && 
         /[a-z]/.test(password) && 
         /\d/.test(password);
}
function handleVerifyToken(params) {
  try {
    const { token } = params;
    
    if (!token) {
      return { success: false, message: 'Token is required' };
    }
    
    const session = findSession(token);
    if (!session) {
      return { success: false, message: 'Invalid token' };
    }
    
    // Check if session is expired
    if (new Date() > new Date(session.expires)) {
      deleteSession(token);
      return { success: false, message: 'Session expired' };
    }
    
    return { success: true, username: session.username };
    
  } catch (error) {
    console.error('Token verification error:', error);
    return { success: false, message: 'Token verification failed: ' + error.toString() };
  }
}

/**
 * Handle dashboard statistics
 */
function handleGetDashboardStats(params) {
  try {
    if (!isValidSession(params.token)) {
      return { success: false, message: 'Unauthorized' };
    }
    
    const users = getAllUsers();
    const totalUsers = users.length;
    const activeUsers = users.filter(user => user.status === 'active').length;
    const pendingUsers = users.filter(user => user.status === 'pending').length;
    
    return {
      success: true,
      data: {
        totalUsers,
        activeUsers,
        pendingUsers
      }
    };
    
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return { success: false, message: 'Failed to get dashboard stats: ' + error.toString() };
  }
}

/**
 * Handle get users
 */
function handleGetUsers(params) {
  try {
    if (!isValidSession(params.token)) {
      return { success: false, message: 'Unauthorized' };
    }
    
    const users = getAllUsers();
    
    return {
      success: true,
      data: users
    };
    
  } catch (error) {
    console.error('Get users error:', error);
    return { success: false, message: 'Failed to get users: ' + error.toString() };
  }
}

/**
 * Handle add user
 */
function handleAddUser(params) {
  try {
    if (!isValidSession(params.token)) {
      return { success: false, message: 'Unauthorized' };
    }
    
    const { fullName, email, role, department, notes } = params;
    
    if (!fullName || !email || !role) {
      return { success: false, message: 'Full name, email, and role are required' };
    }
    
    // Check if user already exists
    if (findUserByEmail(email)) {
      return { success: false, message: 'User with this email already exists' };
    }
    
    // Generate temporary username and password
    const tempUsername = email.split('@')[0] + '_' + Math.random().toString(36).substr(2, 4);
    const tempPassword = generateRandomPassword();
    
    // Add user to spreadsheet
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const usersSheet = spreadsheet.getSheetByName(CONFIG.USERS_SHEET_NAME);
    
    const hashedPassword = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, tempPassword)
    );
    
    usersSheet.appendRow([
      fullName,
      email,
      tempUsername,
      hashedPassword,
      role,
      'pending',
      new Date(),
      notes || ''
    ]);
    
    // Send invitation email
    const emailSent = sendInvitationEmail(email, fullName, tempUsername, tempPassword);
    
    if (!emailSent) {
      return { success: false, message: 'User created but failed to send invitation email' };
    }
    
    return { 
      success: true, 
      message: 'User created and invitation email sent successfully' 
    };
    
  } catch (error) {
    console.error('Add user error:', error);
    return { success: false, message: 'Failed to add user: ' + error.toString() };
  }
}

/**
 * Handle delete user
 */
function handleDeleteUser(params) {
  try {
    if (!isValidSession(params.token)) {
      return { success: false, message: 'Unauthorized' };
    }
    
    const { email } = params;
    
    if (!email) {
      return { success: false, message: 'Email is required' };
    }
    
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const usersSheet = spreadsheet.getSheetByName(CONFIG.USERS_SHEET_NAME);
    const data = usersSheet.getDataRange().getValues();
    
    // Find user row
    let userRowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === email) { // Email is in column B (index 1)
        userRowIndex = i + 1; // +1 because getDataRange is 0-indexed but deleteRow is 1-indexed
        break;
      }
    }
    
    if (userRowIndex === -1) {
      return { success: false, message: 'User not found' };
    }
    
    // Delete the row
    usersSheet.deleteRow(userRowIndex);
    
    return { 
      success: true, 
      message: 'User deleted successfully' 
    };
    
  } catch (error) {
    console.error('Delete user error:', error);
    return { success: false, message: 'Failed to delete user: ' + error.toString() };
  }
}

/**
 * Send invitation email to new user
 */
function sendInvitationEmail(email, fullName, username, password) {
  try {
    const subject = 'Welcome to Lightbox Digital Admin System';
    const body = `
Dear ${fullName},

Welcome to the Lightbox Digital team! You have been granted access to our admin system.

🔑 Your temporary login credentials:
Username: ${username}
Password: ${password}

📋 Next Steps:
1. Visit our account setup page: [YOUR_USER_SETUP_URL]
2. Log in with the temporary credentials above
3. Choose your permanent username and password
4. Start using the admin system!

⚠️ Important Security Notes:
- These are temporary credentials that expire once you complete setup
- You must complete setup within 7 days
- Choose a strong password with at least 8 characters, including uppercase, lowercase, and numbers

🎯 What you'll have access to:
- User management dashboard
- System administration tools
- Project collaboration features

Need help? Reply to this email or contact our admin team.

Best regards,
The Lightbox Digital Team

---
This is an automated message. Please do not reply to this email address.
    `;
    
    GmailApp.sendEmail(email, subject, body);
    return true;
    
  } catch (error) {
    console.error('Email sending error:', error);
    return false;
  }
}

/**
 * Utility functions
 */

function findUser(username) {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const usersSheet = spreadsheet.getSheetByName(CONFIG.USERS_SHEET_NAME);
    const data = usersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][2] === username) { // Username is in column C (index 2)
        return {
          fullName: data[i][0],
          email: data[i][1],
          username: data[i][2],
          password: data[i][3],
          role: data[i][4],
          status: data[i][5],
          createdDate: data[i][6],
          notes: data[i][7]
        };
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('Find user error:', error);
    return null;
  }
}

function findUserByEmail(email) {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const usersSheet = spreadsheet.getSheetByName(CONFIG.USERS_SHEET_NAME);
    const data = usersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === email) { // Email is in column B (index 1)
        return {
          fullName: data[i][0],
          email: data[i][1],
          username: data[i][2],
          password: data[i][3],
          role: data[i][4],
          status: data[i][5],
          createdDate: data[i][6],
          notes: data[i][7]
        };
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('Find user by email error:', error);
    return null;
  }
}

function getAllUsers() {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const usersSheet = spreadsheet.getSheetByName(CONFIG.USERS_SHEET_NAME);
    const data = usersSheet.getDataRange().getValues();
    
    const users = [];
    for (let i = 1; i < data.length; i++) {
      users.push({
        fullName: data[i][0],
        email: data[i][1],
        username: data[i][2],
        role: data[i][4],
        status: data[i][5],
        createdDate: data[i][6],
        notes: data[i][7]
      });
    }
    
    return users;
    
  } catch (error) {
    console.error('Get all users error:', error);
    return [];
  }
}

function generateSessionToken() {
  return Utilities.getUuid();
}

function generateRandomPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function saveSession(token, username) {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sessionsSheet = spreadsheet.getSheetByName(CONFIG.SESSIONS_SHEET_NAME);
    
    const now = new Date();
    const expires = new Date(now.getTime() + CONFIG.SESSION_TIMEOUT);
    
    sessionsSheet.appendRow([token, username, now, expires]);
    
    // Clean up expired sessions
    cleanupExpiredSessions();
    
  } catch (error) {
    console.error('Save session error:', error);
  }
}

function findSession(token) {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sessionsSheet = spreadsheet.getSheetByName(CONFIG.SESSIONS_SHEET_NAME);
    const data = sessionsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === token) { // Token is in column A (index 0)
        return {
          token: data[i][0],
          username: data[i][1],
          created: data[i][2],
          expires: data[i][3]
        };
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('Find session error:', error);
    return null;
  }
}

function deleteSession(token) {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sessionsSheet = spreadsheet.getSheetByName(CONFIG.SESSIONS_SHEET_NAME);
    const data = sessionsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === token) {
        sessionsSheet.deleteRow(i + 1);
        break;
      }
    }
    
  } catch (error) {
    console.error('Delete session error:', error);
  }
}

function isValidSession(token) {
  if (!token) return false;
  
  const session = findSession(token);
  if (!session) return false;
  
  if (new Date() > new Date(session.expires)) {
    deleteSession(token);
    return false;
  }
  
  return true;
}

function cleanupExpiredSessions() {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sessionsSheet = spreadsheet.getSheetByName(CONFIG.SESSIONS_SHEET_NAME);
    const data = sessionsSheet.getDataRange().getValues();
    
    const now = new Date();
    
    // Delete from bottom to top to avoid index shifting
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][3] && new Date(data[i][3]) < now) {
        sessionsSheet.deleteRow(i + 1);
      }
    }
    
  } catch (error) {
    console.error('Cleanup sessions error:', error);
  }
}

/**
 * Setup function - run this once to initialize everything
 */
function setupAdminSystem() {
  // Initialize the spreadsheet
  const result = initializeSpreadsheet();
  console.log('Setup result:', result);
  
  // Clean up any existing sessions
  cleanupExpiredSessions();
  
  return result;
}