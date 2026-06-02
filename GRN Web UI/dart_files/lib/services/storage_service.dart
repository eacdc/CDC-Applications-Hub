import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';

class StorageService {
  static const String _usernameKey = 'username';
  static const String _userIdKey = 'user_id';
  static const String _loginTimeKey = 'login_time';
  static const String _machinesKey = 'machines';
  static const String _selectedMachineKey = 'selected_machine';
  static const String _databaseKey = 'database';

  // Save login data
  static Future<void> saveLoginData(String username, int? userId, List<Map<String, dynamic>> machines, String database) async {
    final prefs = await SharedPreferences.getInstance();
    final loginTime = DateTime.now().millisecondsSinceEpoch;
    
    await prefs.setString(_usernameKey, username);
    if (userId != null) {
      await prefs.setInt(_userIdKey, userId);
    } else {
      await prefs.remove(_userIdKey);
    }
    await prefs.setInt(_loginTimeKey, loginTime);
    await prefs.setString(_machinesKey, jsonEncode(machines));
    await prefs.setString(_databaseKey, database);
  }

  // Get login data
  static Future<Map<String, dynamic>?> getLoginData() async {
    final prefs = await SharedPreferences.getInstance();
    
    final username = prefs.getString(_usernameKey);
    final loginTime = prefs.getInt(_loginTimeKey);
    final userId = prefs.getInt(_userIdKey);
    final machinesJson = prefs.getString(_machinesKey);
    final database = prefs.getString(_databaseKey);
    
    if (username == null || loginTime == null || machinesJson == null) {
      return null;
    }

    // No session timeout - user stays logged in until manual logout

    final machines = List<Map<String, dynamic>>.from(jsonDecode(machinesJson));
    
    return {
      'username': username,
      'userId': userId,
      'loginTime': loginTime,
      'machines': machines,
      'database': database, // Require explicit database - no default
    };
  }

  // Save selected machine
  static Future<void> saveSelectedMachine(Map<String, dynamic> machine) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_selectedMachineKey, jsonEncode(machine));
  }

  // Get selected machine
  static Future<Map<String, dynamic>?> getSelectedMachine() async {
    final prefs = await SharedPreferences.getInstance();
    final machineJson = prefs.getString(_selectedMachineKey);
    
    if (machineJson == null) return null;
    
    return Map<String, dynamic>.from(jsonDecode(machineJson));
  }

  // Clear all login data
  static Future<void> clearLoginData() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_usernameKey);
    await prefs.remove(_loginTimeKey);
    await prefs.remove(_machinesKey);
    await prefs.remove(_selectedMachineKey);
    await prefs.remove(_userIdKey);
    await prefs.remove(_databaseKey);
  }

  // Check if user is logged in
  static Future<bool> isLoggedIn() async {
    final loginData = await getLoginData();
    return loginData != null;
  }

  // Session timeout removed - users stay logged in until manual logout
}
