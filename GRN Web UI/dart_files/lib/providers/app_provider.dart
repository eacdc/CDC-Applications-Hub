import 'dart:async';
import 'package:flutter/material.dart';
import '../models/machine.dart';
import '../models/process.dart';
import '../models/machine_status.dart';
import '../models/api_response.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import '../models/login_result.dart';
import '../widgets/status_warning_dialog.dart';

// Simple cancel token for request cancellation
class CancelToken {
  bool _isCancelled = false;
  
  bool get isCancelled => _isCancelled;
  
  void cancel() {
    _isCancelled = true;
  }
}

// Result class for process operations to distinguish between success and status-only responses
class ProcessOperationResult {
  final bool success;
  final bool isStatusOnly;
  final bool hasRemainingProcesses;
  final bool isFullyCompleted; // Add this field to track if process was fully completed
  
  ProcessOperationResult({
    required this.success, 
    this.isStatusOnly = false,
    this.hasRemainingProcesses = true,
    this.isFullyCompleted = false, // Default to false
  });
  
  // Factory constructors for common cases
  static ProcessOperationResult successfulOperation({bool hasRemainingProcesses = true, bool isFullyCompleted = false}) => 
    ProcessOperationResult(success: true, isStatusOnly: false, hasRemainingProcesses: hasRemainingProcesses, isFullyCompleted: isFullyCompleted);
  static ProcessOperationResult statusOnlyResponse({bool hasRemainingProcesses = true}) => 
    ProcessOperationResult(success: true, isStatusOnly: true, hasRemainingProcesses: hasRemainingProcesses);
  static ProcessOperationResult failure() => 
    ProcessOperationResult(success: false, isStatusOnly: false);
}

class AppProvider extends ChangeNotifier {
  final ApiService _apiService = ApiService();
  
  // State variables
  bool _isLoading = false;
  String? _error;
  String? _currentUsername;
  int? _currentUserId;
  int? _currentLedgerId;
  String? _selectedDatabase;
  List<Machine> _machines = [];
  Machine? _selectedMachine;
  List<Process> _processes = [];
  
  // Process start time tracking (for timer display only)
  Map<String, DateTime> _runningProcesses = {}; // processId -> start time
  bool _isCompletingProcess = false;
  bool _isSubmittingCompletion = false; // Track if currently submitting completion
  bool _lastSearchWasManualEntry = false; // Track if the last search was manual entry
  
  // Store completion input values for the flow
  Map<String, dynamic>? _completionInputs;
  
  // Request cancellation
  CancelToken? _currentRequestToken;
  
  // Context for showing dialogs
  BuildContext? _context;

  // Getters
  bool get isLoading => _isLoading;
  String? get error => _error;
  String? get currentUsername => _currentUsername;
  int? get currentUserId => _currentUserId;
  int? get currentLedgerId => _currentLedgerId;
  String? get selectedDatabase => _selectedDatabase;
  List<Machine> get machines => _machines;
  Machine? get selectedMachine => _selectedMachine;
  List<Process> get processes => _processes;
  Map<String, DateTime> get runningProcesses => _runningProcesses;
  bool get hasProcesses => _processes.isNotEmpty;
  bool get isCompletingProcess => _isCompletingProcess;
  bool get isSubmittingCompletion => _isSubmittingCompletion;

  // Set context for showing dialogs
  void setContext(BuildContext context) {
    _context = context;
  }

  // Clear error
  void clearError() {
    _error = null;
    notifyListeners();
  }

  // Set loading state
  void _setLoading(bool loading) {
    _isLoading = loading;
    notifyListeners();
  }

  // Set error
  void _setError(String error) {
    _error = error;
    _isLoading = false;
    notifyListeners();
  }

  // Login method
  Future<bool> login(String username, String database) async {
    _setLoading(true);
    _error = null;

    try {
      // Clear cache first before login
      final clearCacheResponse = await _apiService.clearCache();
      if (!clearCacheResponse.isSuccess) {
        _setError('Failed to clear cache: ${clearCacheResponse.error}');
        return false;
      }

      // Proceed with login after cache is cleared
      final response = await _apiService.login(username, database);
      
      if (response.isSuccess && response.data != null) {
        final LoginResult result = response.data!;
        // Defensive: ensure server echoed selected db matches client selection
        if (result.selectedDatabase != null &&
            result.selectedDatabase!.toUpperCase() != database.toUpperCase()) {
          _setError('Server database mismatch');
          return false;
        }
        _currentUsername = username;
        _currentUserId = result.userId;
        _currentLedgerId = result.ledgerId;
        _selectedDatabase = database;
        _machines = result.machinesJson
            .map((json) => Machine.fromJson(json as Map<String, dynamic>))
            .toList();
        
        // Save login data to storage
        final machinesJson = _machines.map((machine) => machine.toJson()).toList();
        await StorageService.saveLoginData(username, _currentUserId, machinesJson, database);
        
        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        _setError(response.error ?? 'Login failed');
        return false;
      }
    } catch (e) {
      _setError('Login error: ${e.toString()}');
      return false;
    }
  }

  // Select machine
  void selectMachine(Machine machine) {
    _selectedMachine = machine;
    // Clear processes when selecting a new machine
    _processes.clear();
    _error = null;
    // Save selected machine to storage
    StorageService.saveSelectedMachine(machine.toJson());
    notifyListeners();
  }
  
  // Clear processes (call when navigating back or changing parameters)
  void clearProcesses() {
    _processes.clear();
    _lastSearchWasManualEntry = false; // Reset manual entry flag
    _error = null;
    notifyListeners();
  }

  // Get pending processes
  Future<bool> getPendingProcesses(String jobCardContentNo, {bool isManualEntry = false}) async {
    if (_selectedMachine == null) {
      _setError('No machine selected');
      return false;
    }
    if (_currentUserId == null) {
      _setError('User not identified');
      return false;
    }

    // Cancel any existing request
    _currentRequestToken?.cancel();
    _currentRequestToken = CancelToken();
    
    // Clear previous processes immediately
    _processes.clear();
    _isLoading = true;
    notifyListeners();
    _error = null;

    try {
      final response = await _apiService.getPendingProcesses(
        _currentUserId!,
        _selectedMachine!.machineId,
        jobCardContentNo,
        _currentRequestToken!,
        isManualEntry: isManualEntry,
        database: _selectedDatabase,
      );
      
      // Check if request was cancelled
      if (_currentRequestToken!.isCancelled) {
        return false;
      }
      
      if (response.isSuccess && response.data != null) {
        _processes = response.data!;
        _lastSearchWasManualEntry = isManualEntry; // Track the search mode
        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        _setError(response.error ?? 'Failed to fetch processes');
        return false;
      }
    } catch (e) {
      if (!_currentRequestToken!.isCancelled) {
        _setError('Process fetch error: ${e.toString()}');
      }
      return false;
    }
  }

  Future<ProcessOperationResult> startProcess({
    required int employeeId,
    required int processId,
    required int jobBookingJobCardContentsId,
    required String jobCardFormNo,
    String? jobCardContentNo, // Add job card content no for refresh
  }) async {
    if (_selectedMachine == null) {
      _setError('No machine selected');
      return ProcessOperationResult.failure();
    }
    if (_currentUserId == null) {
      _setError('User not identified');
      return ProcessOperationResult.failure();
    }
    if (_currentLedgerId == null) {
      _setError('Ledger ID not available');
      return ProcessOperationResult.failure();
    }
    final int employeeIdToSend = _currentLedgerId!;

    _isLoading = true;
    try {
      final response = await _apiService.startProduction(
        userId: _currentUserId!,
        employeeId: employeeIdToSend,
        processId: processId,
        jobBookingJobCardContentsId: jobBookingJobCardContentsId,
        machineId: _selectedMachine!.machineId,
        jobCardFormNo: jobCardFormNo,
        database: _selectedDatabase,
      );

      if (response.isSuccess) {
        // Show status warning if present and wait for user to dismiss it
        if (response.hasStatusWarning && _context != null) {
          print('[AppProvider] Status warning detected, showing dialog');
          await StatusWarningDialog.show(
            _context!,
            response.statusWarning!.message,
            response.statusWarning!.statusValue,
          );
          print('[AppProvider] Status warning dialog dismissed, continuing');
          _isLoading = false;
          notifyListeners(); // Update UI state
          return ProcessOperationResult.statusOnlyResponse(); // Return status-only result
        }
        
        // Store start time for timer (only for non-status-only responses)
        final processKey = '${processId}_${jobBookingJobCardContentsId}';
        _runningProcesses[processKey] = DateTime.now();
        
        // No need to refresh process data since we're navigating away immediately
        // This prevents flickering in ProcessListScreen before navigation
        
        _isLoading = false;
        notifyListeners();
        return ProcessOperationResult.successfulOperation();
      } else {
        _setError(response.error ?? 'Failed to start process');
        return ProcessOperationResult.failure();
      }
    } catch (e) {
      _setError('Start process error: ${e.toString()}');
      return ProcessOperationResult.failure();
    }
  }

  Future<ProcessOperationResult> completeProcess({
    required int employeeId,
    required int processId,
    required int jobBookingJobCardContentsId,
    required String jobCardFormNo,
    required int productionQty,
    required int wastageQty,
    String? jobCardContentNo, // Add job card content no for refresh
  }) async {
    if (_selectedMachine == null) {
      _setError('No machine selected');
      return ProcessOperationResult.failure();
    }
    if (_currentUserId == null) {
      _setError('User not identified');
      return ProcessOperationResult.failure();
    }
    if (_currentLedgerId == null) {
      _setError('Ledger ID not available');
      return ProcessOperationResult.failure();
    }

    final int employeeIdToSend = _currentLedgerId!;

    // Step 1: Store input values in variable and set submitting state
    _completionInputs = {
      'employeeId': employeeIdToSend,
      'processId': processId,
      'jobBookingJobCardContentsId': jobBookingJobCardContentsId,
      'jobCardFormNo': jobCardFormNo,
      'productionQty': productionQty,
      'wastageQty': wastageQty,
      'jobCardContentNo': jobCardContentNo,
    };
    
    _isSubmittingCompletion = true;
    _isCompletingProcess = true; // Set flag to prevent automatic navigation
    notifyListeners(); // Notify UI to show "Submitting" state
    
    try {
      // Step 2: Call the process completion SQL procedure
      final response = await _apiService.completeProduction(
        userId: _currentUserId!,
        employeeId: employeeIdToSend,
        processId: processId,
        jobBookingJobCardContentsId: jobBookingJobCardContentsId,
        machineId: _selectedMachine!.machineId,
        jobCardFormNo: jobCardFormNo,
        productionQty: productionQty,
        wastageQty: wastageQty,
        database: _selectedDatabase,
      );

      if (response.isSuccess) {
        // Show status warning if present and wait for user to dismiss it
        if (response.hasStatusWarning && _context != null) {
          print('[AppProvider] Status warning detected, showing dialog');
          await StatusWarningDialog.show(
            _context!,
            response.statusWarning!.message,
            response.statusWarning!.statusValue,
          );
          print('[AppProvider] Status warning dialog dismissed, continuing');
          _isSubmittingCompletion = false;
          _isCompletingProcess = false;
          _completionInputs = null;
          notifyListeners(); // Update UI to reset submit button state
          return ProcessOperationResult.statusOnlyResponse();
        }
        
        // Step 3: Clean up running processes tracking for completed processes
        final processKey = '${processId}_${jobBookingJobCardContentsId}';
        _runningProcesses.remove(processKey);
        
        // Step 4: Clear submitting state - UI will handle navigation
        _isSubmittingCompletion = false;
        _isCompletingProcess = false; // Clear flag
        _completionInputs = null;
        // Note: Not calling notifyListeners() here to avoid widget disposal issues
        // The UI will handle navigation and any necessary updates
        
        return ProcessOperationResult.successfulOperation(
          hasRemainingProcesses: _processes.isNotEmpty,
          isFullyCompleted: true // Process completion always means it's fully completed
        );
      } else {
        _error = response.error ?? 'Failed to complete process';
        _isLoading = false;
        _isSubmittingCompletion = false;
        _isCompletingProcess = false;
        _completionInputs = null;
        notifyListeners(); // Update UI to reset submit button state
        return ProcessOperationResult.failure();
      }
    } catch (e) {
      _error = 'Complete process error: ${e.toString()}';
      _isLoading = false;
      _isSubmittingCompletion = false;
      _isCompletingProcess = false;
      _completionInputs = null;
      notifyListeners(); // Update UI to reset submit button state
      return ProcessOperationResult.failure();
    }
  }

  Future<ProcessOperationResult> cancelProcess({
    required int employeeId,
    required int processId,
    required int jobBookingJobCardContentsId,
    required String jobCardFormNo,
    String? jobCardContentNo, // Add job card content no for refresh
  }) async {
    if (_selectedMachine == null) {
      _setError('No machine selected');
      return ProcessOperationResult.failure();
    }
    if (_currentUserId == null) {
      _setError('User not identified');
      return ProcessOperationResult.failure();
    }
    if (_currentLedgerId == null) {
      _setError('Ledger ID not available');
      return ProcessOperationResult.failure();
    }

    final int employeeIdToSend = _currentLedgerId!;

    _isLoading = true;
    try {
      final response = await _apiService.cancelProduction(
        userId: _currentUserId!,
        employeeId: employeeIdToSend,
        processId: processId,
        jobBookingJobCardContentsId: jobBookingJobCardContentsId,
        machineId: _selectedMachine!.machineId,
        jobCardFormNo: jobCardFormNo,
        database: _selectedDatabase,
      );

      if (response.isSuccess) {
        // Show status warning if present and wait for user to dismiss it
        if (response.hasStatusWarning && _context != null) {
          print('[AppProvider] Status warning detected, showing dialog');
          await StatusWarningDialog.show(
            _context!,
            response.statusWarning!.message,
            response.statusWarning!.statusValue,
          );
          print('[AppProvider] Status warning dialog dismissed, continuing');
          _isLoading = false;
          notifyListeners(); // Update UI state
          return ProcessOperationResult.statusOnlyResponse(); // Return status-only result
        }
        
        // Clean up start time tracking for cancelled processes
        final processKey = '${processId}_${jobBookingJobCardContentsId}';
        _runningProcesses.remove(processKey);
        
        // Clear loading state without notifyListeners to avoid widget disposal issues
        _isLoading = false;
        return ProcessOperationResult.successfulOperation(
          hasRemainingProcesses: _processes.isNotEmpty
        );
      } else {
        _error = response.error ?? 'Failed to cancel process';
        _isLoading = false;
        notifyListeners(); // Update UI state
        return ProcessOperationResult.failure();
      }
    } catch (e) {
      _error = 'Cancel process error: ${e.toString()}';
      _isLoading = false;
      notifyListeners(); // Update UI state
      return ProcessOperationResult.failure();
    }
  }

  bool isProcessRunning(int processId, int jobBookingJobCardContentsId, {String? formNo}) {
    // Find the process in the current processes list
    final process = _findProcess(processId, jobBookingJobCardContentsId, formNo: formNo);
    
    // Only consider process as running if CurrentStatus is "Running"
    // Trim whitespace to handle any extra spaces from the API
    final status = process?.currentStatus?.trim().toLowerCase();
    print('[AppProvider] isProcessRunning check - ProcessID: $processId, JobBookingID: $jobBookingJobCardContentsId, FormNo: ${formNo ?? process?.formNo}, Status: "${process?.currentStatus}", Trimmed: "$status", IsRunning: ${status == 'running'}');
    return status == 'running';
  }

  DateTime? getProcessStartTime(int processId, int jobBookingJobCardContentsId) {
    final processKey = '${processId}_${jobBookingJobCardContentsId}';
    return _runningProcesses[processKey];
  }

  // Register an already-running process (for "View Status" navigation)
  void registerRunningProcess(int processId, int jobBookingJobCardContentsId) {
    final processKey = '${processId}_${jobBookingJobCardContentsId}';
    
    // Only register if not already tracked and process is actually running
    if (!_runningProcesses.containsKey(processKey)) {
      final process = _findProcess(processId, jobBookingJobCardContentsId);
      if (process?.currentStatus?.toLowerCase() == 'running') {
        // Use current time as start time since we don't know the actual start time
        _runningProcesses[processKey] = DateTime.now();
        notifyListeners();
      }
    }
  }

  // Helper method to check if a process status indicates completion
  bool _isProcessCompleted(String? currentStatus) {
    if (currentStatus == null) return true; // Process not found means completed
    final status = currentStatus.toLowerCase();
    return status == 'complete' || status == 'part complete';
  }

  // Helper method to find a process by ID and optionally by FormNo
  Process? _findProcess(int processId, int jobBookingJobCardContentsId, {String? formNo}) {
    try {
      if (formNo != null) {
        // If FormNo is provided, use it as the unique identifier since processId + jobBookingId might not be unique
        return _processes.firstWhere(
          (p) => p.processId == processId && 
                 p.jobBookingJobcardContentsId == jobBookingJobCardContentsId &&
                 p.formNo == formNo,
        );
      } else {
        // Fallback to old logic if FormNo is not provided
        return _processes.firstWhere(
          (p) => p.processId == processId && p.jobBookingJobcardContentsId == jobBookingJobCardContentsId,
        );
      }
    } catch (e) {
      return null; // Process not found
    }
  }

  // Private method to refresh process data from server
  Future<void> _refreshProcessData(String jobCardContentNo, {bool isManualEntry = false}) async {
    try {
      // Create a new cancel token for refresh
      final refreshToken = CancelToken();
      
      final response = await _apiService.getPendingProcesses(
        _currentUserId!,
        _selectedMachine!.machineId,
        jobCardContentNo,
        refreshToken,
        isManualEntry: isManualEntry,
        database: _selectedDatabase,
      );
      
      if (response.isSuccess && response.data != null) {
        _processes = response.data!;
        notifyListeners(); // Notify listeners of the updated process data
      }
    } catch (e) {
      // Don't show error for refresh failures, just log silently
      // The main operation already succeeded
      print('Process refresh error: ${e.toString()}');
    }
  }

  // Logout method
  void logout() {
    // Cancel any pending request
    _currentRequestToken?.cancel();
    _currentRequestToken = null;
    
    _currentUsername = null;
    _currentUserId = null;
    _currentLedgerId = null;
    _selectedDatabase = null;
    _machines.clear();
    _selectedMachine = null;
    _processes.clear();
    _runningProcesses.clear();
    _error = null;
    _isLoading = false;
    _isCompletingProcess = false; // Clear flag on logout
    _isSubmittingCompletion = false; // Clear submitting flag on logout
    _completionInputs = null; // Clear stored inputs on logout
    // Clear stored login data
    StorageService.clearLoginData();
    notifyListeners();
  }

  // Auto-login method (check stored session)
  Future<bool> autoLogin() async {
    _setLoading(true);
    
    try {
      final loginData = await StorageService.getLoginData();
      
      if (loginData != null) {
        _currentUsername = loginData['username'];
        _currentUserId = loginData['userId'];
        _selectedDatabase = loginData['database']; // No default - require explicit database selection
        _machines = (loginData['machines'] as List)
            .map((json) => Machine.fromJson(json))
            .toList();
        
        // Restore selected machine if available
        final selectedMachineData = await StorageService.getSelectedMachine();
        if (selectedMachineData != null) {
          _selectedMachine = Machine.fromJson(selectedMachineData);
        }
        
        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        _isLoading = false;
        notifyListeners();
        return false;
      }
    } catch (e) {
      _setError('Auto-login error: ${e.toString()}');
      return false;
    }
  }

  // Get latest machine status per machine
  Future<ApiResponse<List<MachineStatus>>> getLatestMachineStatusPerMachine() async {
    try {
      final response = await _apiService.getLatestMachineStatusPerMachine(
        database: _selectedDatabase,
      );
      
      if (response.status && response.data != null) {
        final machineStatuses = (response.data as List)
            .map((json) => MachineStatus.fromJson(json))
            .toList();
        
        return ApiResponse<List<MachineStatus>>(
          status: true,
          data: machineStatuses,
        );
      } else {
        return ApiResponse<List<MachineStatus>>(
          status: false,
          data: null,
          error: response.error ?? 'Failed to load machine statuses',
        );
      }
    } catch (e) {
      return ApiResponse<List<MachineStatus>>(
        status: false,
        data: null,
        error: 'Error loading machine statuses: $e',
      );
    }
  }

  // Session timeout removed - users stay logged in until manual logout

  @override
  void dispose() {
    _currentRequestToken?.cancel();
    _apiService.dispose();
    super.dispose();
  }
}