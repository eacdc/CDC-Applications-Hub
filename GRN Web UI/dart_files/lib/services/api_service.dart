import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../models/machine.dart';
import '../models/login_result.dart';
import '../models/process.dart';
import '../models/api_response.dart';
import '../config/api_config.dart';
import '../providers/app_provider.dart';

class ApiService {
  // Using configuration from api_config.dart
  static const String baseUrl = ApiConfig.baseUrl;
  
  final http.Client _client = http.Client();

  // Common headers for web compatibility
  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Clear cache API - Clear database pool cache
  Future<ApiResponse<void>> clearCache() async {
    try {
      final uri = Uri.parse('$baseUrl/admin/clear-db-cache');
      
      final response = await _client.post(uri, headers: _headers);
      
      if (response.statusCode == 200) {
        final Map<String, dynamic> jsonData = json.decode(response.body);
        if (jsonData['status'] == true) {
          return ApiResponse<void>(
            status: true,
            data: null,
          );
        } else {
          return ApiResponse<void>(
            status: false,
            error: jsonData['error'] ?? 'Failed to clear cache',
          );
        }
      } else {
        final Map<String, dynamic> errorData = json.decode(response.body);
        return ApiResponse<void>(
          status: false,
          error: errorData['error'] ?? 'Failed to clear cache',
        );
      }
    } catch (e) {
      return ApiResponse<void>(
        status: false,
        error: 'Network error: ${e.toString()}',
      );
    }
  }

  // Login API - Get machines for a user (returns userId and machines)
  Future<ApiResponse<LoginResult>> login(String username, String database) async {
    try {
      final uri = Uri.parse('$baseUrl/auth/login').replace(
        queryParameters: {
          'username': username,
          'database': database,
        },
      );

      final response = await _client.get(uri, headers: _headers);

      if (response.statusCode == 200) {
        final Map<String, dynamic> jsonData = json.decode(response.body);
        if (jsonData['status'] == true) {
          final result = LoginResult.fromJson(jsonData);
          return ApiResponse<LoginResult>(
            status: true,
            data: result,
          );
        } else {
          return ApiResponse<LoginResult>(
            status: false,
            error: jsonData['error'] ?? 'No machines found for this user',
          );
        }
      } else {
        final Map<String, dynamic> errorData = json.decode(response.body);
        return ApiResponse<LoginResult>(
          status: false,
          error: errorData['error'] ?? 'Login failed',
        );
      }
    } catch (e) {
      return ApiResponse<LoginResult>(
        status: false,
        error: 'Network error: ${e.toString()}',
      );
    }
  }

  // Get pending processes for a machine
  Future<ApiResponse<List<Process>>> getPendingProcesses(int userId, int machineId, String jobCardContentNo, CancelToken cancelToken, {bool isManualEntry = false, String? database}) async {
    try {
      final uri = Uri.parse('$baseUrl/processes/pending').replace(
        queryParameters: {
          'UserID': userId.toString(),
          'MachineID': machineId.toString(),
          'jobcardcontentno': jobCardContentNo,
          'isManualEntry': isManualEntry.toString(),
          if (database != null) 'database': database,
        },
      );

      final response = await _client.get(uri, headers: _headers);

      // Check if request was cancelled
      if (cancelToken.isCancelled) {
        return ApiResponse<List<Process>>(
          status: false,
          error: 'Request cancelled',
        );
      }

      if (response.statusCode == 200) {
        final Map<String, dynamic> jsonData = json.decode(response.body);
        
        if (jsonData['status'] == true && jsonData['processes'] != null) {
          final List<dynamic> processesJson = jsonData['processes'];
          final List<Process> processes = processesJson
              .map((json) => Process.fromJson(json))
              .toList();
          
          return ApiResponse<List<Process>>(
            status: true,
            data: processes,
          );
        } else {
          return ApiResponse<List<Process>>(
            status: false,
            error: jsonData['error'] ?? 'No processes found',
          );
        }
      } else {
        final Map<String, dynamic> errorData = json.decode(response.body);
        return ApiResponse<List<Process>>(
          status: false,
          error: errorData['error'] ?? 'Failed to fetch processes',
        );
      }
    } catch (e) {
      if (cancelToken.isCancelled) {
        return ApiResponse<List<Process>>(
          status: false,
          error: 'Request cancelled',
        );
      }
      return ApiResponse<List<Process>>(
        status: false,
        error: 'Network error: ${e.toString()}',
      );
    }
  }

  // Process QR code from file
  Future<ApiResponse<String>> processQRFromFile(File imageFile) async {
    try {
      var request = http.MultipartRequest('POST', Uri.parse('$baseUrl/qr/process'));
      
      request.files.add(await http.MultipartFile.fromPath(
        'qrImage',
        imageFile.path,
      ));

      final streamedResponse = await _client.send(request);
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200) {
        final Map<String, dynamic> jsonData = json.decode(response.body);
        
        if (jsonData['status'] == true && jsonData['jobCardContentNo'] != null) {
          return ApiResponse<String>(
            status: true,
            data: jsonData['jobCardContentNo'],
          );
        } else {
          return ApiResponse<String>(
            status: false,
            error: jsonData['error'] ?? 'Failed to process QR code',
          );
        }
      } else {
        final Map<String, dynamic> errorData = json.decode(response.body);
        return ApiResponse<String>(
          status: false,
          error: errorData['error'] ?? 'Failed to process QR code',
        );
      }
    } catch (e) {
      return ApiResponse<String>(
        status: false,
        error: 'Network error: ${e.toString()}',
      );
    }
  }

  // Process QR code from base64 data (camera capture)
  Future<ApiResponse<String>> processQRFromBase64(String base64Data) async {
    try {
      final response = await _client.post(
        Uri.parse('$baseUrl/qr/process-base64'),
        headers: _headers,
        body: json.encode({
          'imageData': base64Data,
        }),
      );

      if (response.statusCode == 200) {
        final Map<String, dynamic> jsonData = json.decode(response.body);
        
        if (jsonData['status'] == true && jsonData['jobCardContentNo'] != null) {
          return ApiResponse<String>(
            status: true,
            data: jsonData['jobCardContentNo'],
          );
        } else {
          return ApiResponse<String>(
            status: false,
            error: jsonData['error'] ?? 'Failed to process QR code',
          );
        }
      } else {
        final Map<String, dynamic> errorData = json.decode(response.body);
        return ApiResponse<String>(
          status: false,
          error: errorData['error'] ?? 'Failed to process QR code',
        );
      }
    } catch (e) {
      return ApiResponse<String>(
        status: false,
        error: 'Network error: ${e.toString()}',
      );
    }
  }

  Future<ApiResponse<bool>> startProduction({
    required int userId,
    required int employeeId,
    required int processId,
    required int jobBookingJobCardContentsId,
    required int machineId,
    required String jobCardFormNo,
    String? database,
  }) async {
    try {
      final response = await _client.post(
        Uri.parse('$baseUrl/processes/start'),
        headers: _headers,
        body: json.encode({
          'UserID': userId,
          'EmployeeID': employeeId,
          'ProcessID': processId,
          'JobBookingJobCardContentsID': jobBookingJobCardContentsId,
          'MachineID': machineId,
          'JobCardFormNo': jobCardFormNo,
          if (database != null) 'database': database,
        }),
      );

      if (response.statusCode == 200) {
        final Map<String, dynamic> jsonData = json.decode(response.body);
        if (jsonData['status'] == true) {
          return ApiResponse<bool>(
            status: true, 
            data: true,
            statusWarning: jsonData['statusWarning'] != null ? StatusWarning.fromJson(jsonData['statusWarning']) : null,
          );
        } else {
          return ApiResponse<bool>(status: false, error: jsonData['error'] ?? 'Failed to start production');
        }
      } else {
        final Map<String, dynamic> errorData = json.decode(response.body);
        return ApiResponse<bool>(status: false, error: errorData['error'] ?? 'Failed to start production');
      }
    } catch (e) {
      return ApiResponse<bool>(status: false, error: 'Network error: ${e.toString()}');
    }
  }

  Future<ApiResponse<bool>> completeProduction({
    required int userId,
    required int employeeId,
    required int processId,
    required int jobBookingJobCardContentsId,
    required int machineId,
    required String jobCardFormNo,
    required int productionQty,
    required int wastageQty,
    String? database,
  }) async {
    try {
      final response = await _client.post(
        Uri.parse('$baseUrl/processes/complete'),
        headers: _headers,
        body: json.encode({
          'UserID': userId,
          'EmployeeID': employeeId,
          'ProcessID': processId,
          'JobBookingJobCardContentsID': jobBookingJobCardContentsId,
          'MachineID': machineId,
          'JobCardFormNo': jobCardFormNo,
          'ProductionQty': productionQty,
          'WastageQty': wastageQty,
          if (database != null) 'database': database,
        }),
      );

      if (response.statusCode == 200) {
        final Map<String, dynamic> jsonData = json.decode(response.body);
        if (jsonData['status'] == true) {
          return ApiResponse<bool>(
            status: true, 
            data: true,
            statusWarning: jsonData['statusWarning'] != null ? StatusWarning.fromJson(jsonData['statusWarning']) : null,
          );
        } else {
          return ApiResponse<bool>(status: false, error: jsonData['error'] ?? 'Failed to complete production');
        }
      } else {
        final Map<String, dynamic> errorData = json.decode(response.body);
        return ApiResponse<bool>(status: false, error: errorData['error'] ?? 'Failed to complete production');
      }
    } catch (e) {
      return ApiResponse<bool>(status: false, error: 'Network error: ${e.toString()}');
    }
  }

  Future<ApiResponse<bool>> cancelProduction({
    required int userId,
    required int employeeId,
    required int processId,
    required int jobBookingJobCardContentsId,
    required int machineId,
    required String jobCardFormNo,
    String? database,
  }) async {
    try {
      final response = await _client.post(
        Uri.parse('$baseUrl/processes/cancel'),
        headers: _headers,
        body: json.encode({
          'UserID': userId,
          'EmployeeID': employeeId,
          'ProcessID': processId,
          'JobBookingJobCardContentsID': jobBookingJobCardContentsId,
          'MachineID': machineId,
          'JobCardFormNo': jobCardFormNo,
          if (database != null) 'database': database,
        }),
      );

      if (response.statusCode == 200) {
        final Map<String, dynamic> jsonData = json.decode(response.body);
        if (jsonData['status'] == true) {
          return ApiResponse<bool>(
            status: true, 
            data: true,
            statusWarning: jsonData['statusWarning'] != null ? StatusWarning.fromJson(jsonData['statusWarning']) : null,
          );
        } else {
          return ApiResponse<bool>(status: false, error: jsonData['error'] ?? 'Failed to cancel production');
        }
      } else {
        final Map<String, dynamic> errorData = json.decode(response.body);
        return ApiResponse<bool>(status: false, error: errorData['error'] ?? 'Failed to cancel production');
      }
    } catch (e) {
      return ApiResponse<bool>(status: false, error: 'Network error: ${e.toString()}');
    }
  }

  // Get latest machine status per machine
  Future<ApiResponse<List<Map<String, dynamic>>>> getLatestMachineStatusPerMachine({
    String? database,
  }) async {
    try {
      final uri = Uri.parse('$baseUrl/machine-status/latest');
      
      final Map<String, dynamic> requestBody = {};
      if (database != null) {
        requestBody['database'] = database;
      }
      
      final response = await _client.post(
        uri,
        headers: _headers,
        body: json.encode(requestBody),
      );
      
      if (response.statusCode == 200) {
        final Map<String, dynamic> jsonData = json.decode(response.body);
        if (jsonData['status'] == true) {
          final List<dynamic> data = jsonData['data'] ?? [];
          return ApiResponse<List<Map<String, dynamic>>>(
            status: true,
            data: data.cast<Map<String, dynamic>>(),
          );
        } else {
          return ApiResponse<List<Map<String, dynamic>>>(
            status: false,
            error: jsonData['error'] ?? 'Failed to get machine statuses',
          );
        }
      } else {
        final Map<String, dynamic> errorData = json.decode(response.body);
        return ApiResponse<List<Map<String, dynamic>>>(
          status: false,
          error: errorData['error'] ?? 'Failed to get machine statuses',
        );
      }
    } catch (e) {
      return ApiResponse<List<Map<String, dynamic>>>(
        status: false,
        error: 'Network error: ${e.toString()}',
      );
    }
  }

  void dispose() {
    _client.close();
  }
}