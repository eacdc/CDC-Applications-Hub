class ApiConfig {
  // Configuration for different environments
  
  // For local development (localhost)
  static const String localUrl = 'http://localhost:3001/api';
  
  // For web testing - replace with your PC's IP address
  // Find your IP by running: ipconfig in Command Prompt
  // Look for "IPv4 Address" under your network adapter
  static const String webUrl = 'http://192.168.0.156:51175/api'; // Your computer's IP with actual backend port
  
  // For Android emulator
  static const String androidEmulatorUrl = 'http://10.0.2.2:3001/api';
  
  // Production backend on Render
  static const String productionUrl = 'https://cdcapi.onrender.com/api';
  
  // Current URL being used
  // Change this to switch between environments
  static const String baseUrl = productionUrl; // Using production URL on Render
}
