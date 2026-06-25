require('dotenv').config();
const bcrypt = require('bcrypt');
const SpiderApi = require('./spiderApi');

async function createAdmin() {
  try {
    console.log('Checking/Altering users table to allow admin role...');
    try {
      await SpiderApi.query(`ALTER TABLE users MODIFY COLUMN role ENUM('client', 'technician', 'admin') DEFAULT 'client'`);
      console.log('Altered table successfully');
    } catch (e) {
      console.log('Alter table might have failed or not needed:', e.message);
    }

    const email = 'admin@techcare.com';
    const username = 'admin';
    const password = 'adminpassword';
    
    // Check if user exists
    const existing = await SpiderApi.query(`SELECT * FROM users WHERE email = '${email}'`);
    if (existing && existing.length > 0) {
      console.log('User already exists, updating to admin role...');
      const hashed = await bcrypt.hash(password, 10);
      await SpiderApi.query(`UPDATE users SET role = 'admin', password = '${hashed}' WHERE email = '${email}'`);
      console.log('Admin user updated!');
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    await SpiderApi.query(`INSERT INTO users (username, password, email, role) VALUES ('${username}', '${hashed}', '${email}', 'admin')`);
    console.log('Admin user created successfully! Email: admin@techcare.com / Password: adminpassword');
  } catch (err) {
    console.error('Error creating admin:', err);
  }
}

createAdmin();
