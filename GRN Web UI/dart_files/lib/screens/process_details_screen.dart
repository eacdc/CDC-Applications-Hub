import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import 'dart:io';
import 'dart:convert';
import '../providers/app_provider.dart';
import '../models/process.dart';
import '../models/api_response.dart';
import '../services/api_service.dart';
import 'package:flutter/foundation.dart';
import 'process_list_screen.dart';
import 'qr_scanner_screen.dart';

class ProcessDetailsScreen extends StatefulWidget {
  const ProcessDetailsScreen({super.key});

  @override
  State<ProcessDetailsScreen> createState() => _ProcessDetailsScreenState();
}

class _ProcessDetailsScreenState extends State<ProcessDetailsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _jobCardContentNoController = TextEditingController();
  final ApiService _apiService = ApiService();
  bool _isQRFieldReadOnly = true;
  bool _isProcessingQR = false;

  @override
  void dispose() {
    _jobCardContentNoController.dispose();
    // Clear processes when leaving this screen
    final appProvider = Provider.of<AppProvider>(context, listen: false);
    appProvider.clearProcesses();
    super.dispose();
  }

  Future<void> _showQRScannerDialog() async {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('Scan QR Code'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (!kIsWeb) // Only show camera option on mobile platforms
                ListTile(
                  leading: const Icon(Icons.camera_alt),
                  title: const Text('Scan with Camera'),
                  onTap: () {
                    Navigator.pop(context);
                    _scanQRWithCamera();
                  },
                ),
              ListTile(
                leading: const Icon(Icons.upload_file),
                title: const Text('Upload QR Image'),
                onTap: () {
                  Navigator.pop(context);
                  _pickAndProcessQRImage();
                },
              ),
              ListTile(
                leading: const Icon(Icons.edit),
                title: const Text('Enter Manually'),
                onTap: () {
                  Navigator.pop(context);
                  _enableManualEntry();
                },
              ),
            ],
          ),
        );
      },
    );
  }

  void _enableManualEntry() {
    setState(() {
      _isQRFieldReadOnly = false;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Manual entry enabled. You can now type the Job Card Content No.'),
        backgroundColor: Colors.green,
      ),
    );
  }

  Future<void> _scanQRWithCamera() async {
    try {
      final result = await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => const QRScannerScreen(),
        ),
      );

      if (result != null && result is String && result.isNotEmpty) {
        _processQRResult(result);
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Error opening camera: ${e.toString()}'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  Future<void> _pickAndProcessQRImage() async {
    try {
      FilePickerResult? result = await FilePicker.platform.pickFiles(
        type: FileType.image,
        allowMultiple: false,
        withData: true, // Important for web - gets bytes instead of path
      );

      if (result != null && result.files.single.bytes != null) {
        setState(() {
          _isProcessingQR = true;
        });

        // For web, use bytes directly. For mobile, use path if available
        ApiResponse<String> response;
        if (kIsWeb || result.files.single.path == null) {
          // Web or when path is not available - use bytes
          final bytes = result.files.single.bytes!;
          final base64String = base64Encode(bytes);
          response = await _apiService.processQRFromBase64('data:image/png;base64,$base64String');
        } else {
          // Mobile with path available
          final file = File(result.files.single.path!);
          response = await _apiService.processQRFromFile(file);
        }

        setState(() {
          _isProcessingQR = false;
        });

        if (response.status && response.data != null) {
          _processQRResult(response.data!);
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(response.error ?? 'Failed to process QR code'),
              backgroundColor: Colors.red,
            ),
          );
        }
      }
    } catch (e) {
      setState(() {
        _isProcessingQR = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Error picking file: ${e.toString()}'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  void _processQRResult(String qrData) {
    setState(() {
      _jobCardContentNoController.text = qrData;
      _isQRFieldReadOnly = true;
    });
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('QR Code processed: $qrData'),
        backgroundColor: Colors.green,
      ),
    );
  }

  Future<void> _handleGetProcesses() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    final jobCardContentNo = _jobCardContentNoController.text.trim();
    if (jobCardContentNo.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter a valid Job Card Content No'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    final appProvider = Provider.of<AppProvider>(context, listen: false);
    final success = await appProvider.getPendingProcesses(jobCardContentNo, isManualEntry: !_isQRFieldReadOnly);

    if (mounted) {
      if (success && appProvider.processes.isNotEmpty) {
        // Navigate to new page when processes are found
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => ProcessListScreen(
              jobCardContentNo: jobCardContentNo,
            ),
          ),
        );
      } else if (!success) {
        // Show popup/snackbar when no processes found or error occurred
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(appProvider.error ?? 'No processes found for this Job Card Content No'),
            backgroundColor: Colors.orange,
            duration: const Duration(seconds: 4),
            action: SnackBarAction(
              label: 'OK',
              textColor: Colors.white,
              onPressed: () {
                ScaffoldMessenger.of(context).hideCurrentSnackBar();
              },
            ),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Process Details'),
        actions: [
          IconButton(
            icon: const Icon(Icons.home),
            onPressed: () {
              // Clear processes when navigating back
              final appProvider = Provider.of<AppProvider>(context, listen: false);
              appProvider.clearProcesses();
              Navigator.popUntil(context, (route) => route.isFirst);
            },
          ),
        ],
      ),
      body: Consumer<AppProvider>(
        builder: (context, appProvider, child) {
          return SingleChildScrollView(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Selected Machine Info
                if (appProvider.selectedMachine != null) ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.blue.shade50,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.blue.shade200),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Selected Machine',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: Colors.blue,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          appProvider.selectedMachine!.machineName,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          'ID: ${appProvider.selectedMachine!.machineId}',
                          style: const TextStyle(
                            color: Colors.grey,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                ],

                // Job Card Content No Input Form
                Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Enter Job Card Content No',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: _jobCardContentNoController,
                              keyboardType: TextInputType.text,
                              readOnly: _isQRFieldReadOnly,
                              decoration: InputDecoration(
                                labelText: 'Job Card Content No',
                                hintText: _isQRFieldReadOnly 
                                    ? 'Scan QR code or tap to enter manually'
                                    : 'Enter Job Card Content Number',
                                prefixIcon: const Icon(Icons.assignment),
                                filled: _isQRFieldReadOnly,
                                fillColor: _isQRFieldReadOnly 
                                    ? Colors.grey.shade100 
                                    : null,
                              ),
                              validator: (value) {
                                if (value == null || value.trim().isEmpty) {
                                  return 'Please enter Job Card Content No';
                                }
                                return null;
                              },
                              onTap: _isQRFieldReadOnly ? _showQRScannerDialog : null,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Container(
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(
                                colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
                              ),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: IconButton(
                              onPressed: _isProcessingQR ? null : _showQRScannerDialog,
                              icon: _isProcessingQR
                                  ? const SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                                      ),
                                    )
                                  : const Icon(Icons.qr_code_scanner, color: Colors.white),
                              tooltip: 'Scan QR Code',
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: appProvider.isLoading ? null : _handleGetProcesses,
                          child: appProvider.isLoading
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                                  ),
                                )
                              : const Text(
                                  'Get Process Details',
                                  style: TextStyle(fontSize: 16),
                                ),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 24),

                // Instructions
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.blue.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.blue.shade200),
                  ),
                  child: Column(
                    children: [
                      Icon(
                        Icons.info_outline,
                        size: 48,
                        color: Colors.blue.shade600,
                      ),
                      const SizedBox(height: 12),
                      const Text(
                        'How to get processes',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Colors.blue,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        '1. Scan a QR code or enter Job Card Content No manually\n2. Click "Get Process Details" button\n3. If processes are found, they will open in a new page',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 14,
                          color: Colors.grey,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}


