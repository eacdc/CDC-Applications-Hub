import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_provider.dart';
import '../models/process.dart';
import '../widgets/production_timer.dart';
import '../widgets/complete_production_dialog.dart';
import 'process_details_screen.dart';

class RunningProcessScreen extends StatefulWidget {
  final Process process;
  final String jobCardContentNo;
  
  const RunningProcessScreen({
    super.key,
    required this.process,
    required this.jobCardContentNo,
  });

  @override
  State<RunningProcessScreen> createState() => _RunningProcessScreenState();
}

class _RunningProcessScreenState extends State<RunningProcessScreen> {
  bool _showCompleteForm = false;
  final _formKey = GlobalKey<FormState>();
  final _productionQtyController = TextEditingController();
  final _wastageQtyController = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Don't prefill production qty, let user enter it manually
    _productionQtyController.text = '';
    _wastageQtyController.text = '0';
    
    // Set context for AppProvider to show status warnings
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final appProvider = Provider.of<AppProvider>(context, listen: false);
      appProvider.setContext(context);
      
      // Register this process as running if it's not already tracked
      // This ensures "View Status" navigation works the same as "Start" navigation
      if (widget.process.processId != null) {
        appProvider.registerRunningProcess(
          widget.process.processId!,
          widget.process.jobBookingJobcardContentsId,
        );
      }
    });
  }

  @override
  void dispose() {
    _productionQtyController.dispose();
    _wastageQtyController.dispose();
    super.dispose();
  }

  // Helper method to extract number after last underscore from FormNo
  String _extractFormNumber(String formNo) {
    final parts = formNo.split('_');
    if (parts.isNotEmpty) {
      return parts.last;
    }
    return '';
  }

  void _handleCompleteSubmit() async {
    if (_formKey.currentState!.validate()) {
      final productionQty = int.tryParse(_productionQtyController.text) ?? 0;
      final wastageQty = int.tryParse(_wastageQtyController.text) ?? 0;
      
      final appProvider = Provider.of<AppProvider>(context, listen: false);
      final int employeeId = appProvider.currentLedgerId ?? appProvider.currentUserId ?? 0;
      final int processId = widget.process.processId ?? 0;
      
      final result = await appProvider.completeProcess(
        employeeId: employeeId,
        processId: processId,
        jobBookingJobCardContentsId: widget.process.jobBookingJobcardContentsId,
        jobCardFormNo: widget.process.formNo,
        productionQty: productionQty,
        wastageQty: wastageQty,
        jobCardContentNo: widget.jobCardContentNo,
      );
      
      if (result.success && mounted) {
        if (!result.isStatusOnly) {
          // Show success message
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Production completed')),
          );
          
          // Navigate safely after current build cycle completes
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) {
              final appProvider = Provider.of<AppProvider>(context, listen: false);
              appProvider.clearProcesses();
              
              // Use pushAndRemoveUntil to go directly to ProcessDetailsScreen
              Navigator.pushAndRemoveUntil(
                context,
                MaterialPageRoute(builder: (context) => const ProcessDetailsScreen()),
                (route) => route.isFirst, // Keep only the first route (MachineSelectionScreen)
              );
            }
          });
        }
        // For status-only responses, dialog was already shown, just stay on current page
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final String formNumber = _extractFormNumber(widget.process.formNo);
    
    return WillPopScope(
      onWillPop: () async {
        // Always block back navigation from running process screen
        // Show a dialog to confirm if user wants to cancel the process
        final shouldPop = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Cancel Process?'),
            content: const Text('Are you sure you want to cancel this running process?'),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('No'),
              ),
              TextButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Yes, Cancel'),
              ),
            ],
          ),
        );
        return shouldPop ?? false;
      },
      child: Scaffold(
      appBar: AppBar(
        title: const Text('Running Process'),
        automaticallyImplyLeading: false, // Remove back button
        // No actions - removed home button
      ),
      body: Consumer<AppProvider>(
        builder: (context, appProvider, child) {
          final isRunning = appProvider.isProcessRunning(
            widget.process.processId ?? 0,
            widget.process.jobBookingJobcardContentsId,
            formNo: widget.process.formNo,
          );
          final startTime = appProvider.getProcessStartTime(
            widget.process.processId ?? 0,
            widget.process.jobBookingJobcardContentsId,
          );
          
          // Debug info
          print('[RunningProcessScreen] FormNo: ${widget.process.formNo}, isRunning: $isRunning, startTime: $startTime, currentStatus: ${widget.process.currentStatus}');

          // Automatic navigation disabled - we now handle navigation manually in completion/cancellation
          // This prevents conflicts between automatic and manual navigation
          // if (!isRunning && !appProvider.isCompletingProcess && !appProvider.isSubmittingCompletion) {
          //   WidgetsBinding.instance.addPostFrameCallback((_) {
          //     if (mounted && Navigator.canPop(context)) {
          //       Navigator.of(context).pop(); // This will go back to the process list screen
          //     }
          //   });
          // }

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Process Card
                Card(
                  elevation: 3,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Container(
                    width: double.infinity,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      color: Colors.orange.shade50,
                      border: Border.all(
                        color: Colors.orange.shade200,
                        width: 2,
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Header row: Process name with form number, Action buttons
                          Row(
                            children: [
                              Container(
                                width: 32,
                                height: 32,
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    colors: [
                                      Colors.orange.shade400,
                                      Colors.orange.shade600,
                                    ],
                                  ),
                                  borderRadius: BorderRadius.circular(16),
                                ),
                                child: const Center(
                                  child: Icon(
                                    Icons.play_arrow,
                                    color: Colors.white,
                                    size: 18,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Text(
                                  formNumber.isNotEmpty 
                                      ? '${widget.process.processName} ($formNumber)' 
                                      : widget.process.processName,
                                  style: const TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.black87,
                                  ),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              // Action buttons
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  // Cancel button - enabled if process is running OR has start time
                                  ElevatedButton.icon(
                                    onPressed: (isRunning || startTime != null) ? () async {
                                      final int employeeId = appProvider.currentLedgerId ?? appProvider.currentUserId ?? 0;
                                      final int processId = widget.process.processId ?? 0;
                                      final result = await appProvider.cancelProcess(
                                        employeeId: employeeId,
                                        processId: processId,
                                        jobBookingJobCardContentsId: widget.process.jobBookingJobcardContentsId,
                                        jobCardFormNo: widget.process.formNo,
                                        jobCardContentNo: widget.jobCardContentNo,
                                      );
                                      if (result.success && mounted) {
                                        if (!result.isStatusOnly) {
                                          // Show success message and navigate back to process list screen immediately
                                          ScaffoldMessenger.of(context).showSnackBar(
                                            const SnackBar(content: Text('Production cancelled')),
                                          );
                                          
                                          // Navigate back to process details screen (search screen) directly
                                          WidgetsBinding.instance.addPostFrameCallback((_) {
                                            if (mounted) {
                                              Navigator.pushAndRemoveUntil(
                                                context,
                                                MaterialPageRoute(builder: (context) => const ProcessDetailsScreen()),
                                                (route) => route.isFirst,
                                              );
                                            }
                                          });
                                        }
                                        // For status-only responses, dialog was already shown, just stay on current page
                                      }
                                    } : null,
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: Colors.red,
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                      minimumSize: const Size(0, 0),
                                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                    ),
                                    icon: const Icon(Icons.cancel, size: 16),
                                    label: const Text('Cancel'),
                                  ),
                                  const SizedBox(width: 8),
                                  // Complete button - enabled if process is running OR has start time
                                  ElevatedButton.icon(
                                    onPressed: (isRunning || startTime != null) ? () {
                                      setState(() {
                                        _showCompleteForm = !_showCompleteForm;
                                      });
                                    } : null,
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: Colors.green,
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                      minimumSize: const Size(0, 0),
                                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                    ),
                                    icon: Icon(_showCompleteForm ? Icons.expand_less : Icons.check_circle, size: 16),
                                    label: Text(_showCompleteForm ? 'Hide Form' : 'Complete'),
                                  ),
                                ],
                              ),
                              ],
                          ),
                          
                          
                          const SizedBox(height: 16),
                          
                          // Content area: Fields in two columns with quantities in left column
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Left column - Client, Job, Component, and Quantities
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    _InfoRow(
                                      icon: Icons.business,
                                      label: 'Client',
                                      value: widget.process.client,
                                      iconColor: Colors.blue,
                                    ),
                                    const SizedBox(height: 6),
                                    _InfoRow(
                                      icon: Icons.work,
                                      label: 'Job',
                                      value: widget.process.jobName,
                                      iconColor: Colors.green,
                                    ),
                                    const SizedBox(height: 6),
                                    _InfoRow(
                                      icon: Icons.inventory,
                                      label: 'Component',
                                      value: widget.process.componentName,
                                      iconColor: Colors.orange,
                                    ),
                                    const SizedBox(height: 12),
                                    // Quantities in the same column
                                    Row(
                                      children: [
                                        _QuantityBadge(
                                          label: 'Schedule',
                                          value: widget.process.scheduleQty,
                                          color: Colors.green,
                                        ),
                                        const SizedBox(width: 8),
                                        _QuantityBadge(
                                          label: 'Produced',
                                          value: widget.process.qtyProduced,
                                          color: Colors.orange,
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                              
                              const SizedBox(width: 16),
                              
                              // Right column - PWO and Form only
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    _InfoRow(
                                      icon: Icons.receipt,
                                      label: 'PWO',
                                      value: widget.process.pwoNo,
                                      iconColor: Colors.purple,
                                    ),
                                    const SizedBox(height: 6),
                                    _InfoRow(
                                      icon: Icons.description,
                                      label: 'Form',
                                      value: widget.process.formNo,
                                      iconColor: Colors.teal,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                
                const SizedBox(height: 20),
                
                // Timer below the card - show if we have a start time (process was started)
                if (startTime != null) ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Colors.green.shade50, Colors.green.shade100],
                      ),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.green.shade200),
                    ),
                    child: Column(
                      children: [
                        const Icon(
                          Icons.timer,
                          size: 32,
                          color: Colors.green,
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Production Time',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: Colors.green,
                          ),
                        ),
                        const SizedBox(height: 8),
                        ProductionTimer(
                          startTime: startTime,
                          color: Colors.green,
                        ),
                      ],
                    ),
                  ),
                  
                  const SizedBox(height: 20),
                  
                  
                  
                  
                  // Conditional form rendering
                  if (_showCompleteForm)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.blue.shade50,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.blue.shade200),
                      ),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Complete Production',
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: Colors.blue,
                              ),
                            ),
                            const SizedBox(height: 8),
                            const Text(
                              'Enter production and wastage quantities:',
                              style: TextStyle(
                                fontSize: 14,
                                color: Colors.grey,
                              ),
                            ),
                            const SizedBox(height: 20),
                            
                            // Production Qty Field
                            TextFormField(
                              controller: _productionQtyController,
                              keyboardType: TextInputType.number,
                              decoration: InputDecoration(
                                labelText: 'Production Qty',
                                hintText: 'Enter actual produced quantity',
                                prefixIcon: Container(
                                  margin: const EdgeInsets.all(8),
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: Colors.green.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: const Icon(
                                    Icons.inventory,
                                    color: Colors.green,
                                    size: 16,
                                  ),
                                ),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: const BorderSide(color: Colors.green, width: 2),
                                ),
                              ),
                              validator: (value) {
                                if (value == null || value.trim().isEmpty) {
                                  return 'Please enter production quantity';
                                }
                                final qty = int.tryParse(value);
                                if (qty == null || qty < 0) {
                                  return 'Please enter a valid quantity';
                                }
                                return null;
                              },
                            ),
                            const SizedBox(height: 16),
                            
                            // Wastage Qty Field
                            TextFormField(
                              controller: _wastageQtyController,
                              keyboardType: TextInputType.number,
                              decoration: InputDecoration(
                                labelText: 'Wastage Qty',
                                hintText: 'Enter wastage quantity',
                                prefixIcon: Container(
                                  margin: const EdgeInsets.all(8),
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: Colors.orange.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: const Icon(
                                    Icons.warning,
                                    color: Colors.orange,
                                    size: 16,
                                  ),
                                ),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: const BorderSide(color: Colors.orange, width: 2),
                                ),
                              ),
                              validator: (value) {
                                if (value == null || value.trim().isEmpty) {
                                  return 'Please enter wastage quantity (0 if none)';
                                }
                                final qty = int.tryParse(value);
                                if (qty == null || qty < 0) {
                                  return 'Please enter a valid quantity';
                                }
                                return null;
                              },
                            ),
                            
                            const SizedBox(height: 20),
                            
                            // Submit buttons
                            Row(
                              children: [
                                Expanded(
                                  child: OutlinedButton(
                                    onPressed: () {
                                      setState(() {
                                        _showCompleteForm = false;
                                      });
                                    },
                                    child: const Text('Cancel'),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: ElevatedButton(
                                    onPressed: appProvider.isSubmittingCompletion ? null : _handleCompleteSubmit,
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: Colors.green,
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(vertical: 12),
                                    ),
                                    child: appProvider.isSubmittingCompletion
                                      ? Row(
                                          mainAxisAlignment: MainAxisAlignment.center,
                                          mainAxisSize: MainAxisSize.min,
                                          children: const [
                                            SizedBox(
                                              width: 16,
                                              height: 16,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: Colors.white,
                                              ),
                                            ),
                                            SizedBox(width: 8),
                                            Text(
                                              'Submitting...',
                                              style: TextStyle(fontWeight: FontWeight.bold),
                                            ),
                                          ],
                                        )
                                      : const Text(
                                          'Submit',
                                          style: TextStyle(fontWeight: FontWeight.bold),
                                        ),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ],
            ),
          );
        },
      ),
    ),
  );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color iconColor;

  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
    required this.iconColor,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 16,
          height: 16,
          decoration: BoxDecoration(
            color: iconColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(3),
          ),
          child: Icon(
            icon,
            size: 10,
            color: iconColor,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: RichText(
            text: TextSpan(
              style: TextStyle(
                fontSize: 12,
                color: Colors.grey.shade700,
                fontWeight: FontWeight.w500,
              ),
              children: [
                TextSpan(
                  text: '$label: ',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: Colors.grey.shade600,
                  ),
                ),
                TextSpan(
                  text: value,
                  style: const TextStyle(
                    fontWeight: FontWeight.w500,
                    color: Colors.black87,
                  ),
                ),
              ],
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _QuantityBadge extends StatelessWidget {
  final String label;
  final int value;
  final Color color;

  const _QuantityBadge({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.3), width: 1),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 8,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value.toString(),
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
