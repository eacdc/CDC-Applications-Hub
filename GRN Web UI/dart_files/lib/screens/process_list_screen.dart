import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_provider.dart';
import '../models/process.dart';
import '../widgets/production_timer.dart';
import '../widgets/complete_production_dialog.dart';
import 'running_process_screen.dart';
import 'no_processes_found_screen.dart';
import 'package:intl/intl.dart';
import 'package:flutter/services.dart';

class ProcessListScreen extends StatefulWidget {
  final String jobCardContentNo;
  
  const ProcessListScreen({
    super.key,
    required this.jobCardContentNo,
  });

  @override
  State<ProcessListScreen> createState() => _ProcessListScreenState();
}

class _ProcessListScreenState extends State<ProcessListScreen> {
  int _displayedCount = 10; // Number of processes currently displayed
  List<Process> _lastProcesses = []; // Track last processes to detect changes
  
  @override
  void initState() {
    super.initState();
    // Reset displayed count when screen is initialized
    _displayedCount = 10;
    
    // Set context for AppProvider to show status warnings
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final appProvider = Provider.of<AppProvider>(context, listen: false);
      appProvider.setContext(context);
    });
  }

  // Method to reset pagination when processes change
  void _resetPaginationIfNeeded(List<Process> currentProcesses) {
    if (_lastProcesses.length != currentProcesses.length ||
        !_lastProcesses.every((element) => currentProcesses.contains(element))) {


























          
      _displayedCount = 10;
      _lastProcesses = List.from(currentProcesses);
    }
  }

  // Helper method to sort all processes by PWO date (old to new)
  List<Process> _getSortedProcesses(List<Process> processes) {
    List<Process> sortedProcesses = List.from(processes);
    
    // Sort by PWO date (old to new)
    sortedProcesses.sort((a, b) {
      try {
        DateTime dateA = DateTime.parse(a.pwoDate);
        DateTime dateB = DateTime.parse(b.pwoDate);
        return dateA.compareTo(dateB);
      } catch (e) {
        // If date parsing fails, maintain original order
        return 0;
      }
    });
    
    return sortedProcesses;
  }

  // Helper method to get processes to display (with pagination)
  List<Process> _getDisplayedProcesses(List<Process> processes) {
    final sortedProcesses = _getSortedProcesses(processes);
    return sortedProcesses.take(_displayedCount).toList();
  }

  // Helper method to get running processes
  List<Process> _getRunningProcesses(List<Process> processes, AppProvider appProvider) {
    final running = processes.where((process) {
      final isRunning = appProvider.isProcessRunning(
        process.processId ?? 0,
        process.jobBookingJobcardContentsId,
        formNo: process.formNo,
      );
      print('[ProcessListScreen] Process ${process.processName} (ID: ${process.processId}, FormNo: ${process.formNo}) - Status: "${process.currentStatus}" - IsRunning: $isRunning');
      return isRunning;
    }).toList();
    print('[ProcessListScreen] Total processes: ${processes.length}, Running: ${running.length}');
    return running;
  }

  // Helper method to get non-running processes
  List<Process> _getNonRunningProcesses(List<Process> processes, AppProvider appProvider) {
    return processes.where((process) => 
      !appProvider.isProcessRunning(
        process.processId ?? 0,
        process.jobBookingJobcardContentsId,
        formNo: process.formNo,
      )
    ).toList();
  }

  // Helper method to format PWO date to MM-dd-yyyy
  String _formatPwoDate(String pwoDate) {
    try {
      DateTime date = DateTime.parse(pwoDate);
      return DateFormat('MM-dd-yyyy').format(date);
    } catch (e) {
      return pwoDate; // Return original if parsing fails
    }
  }

  // Method to load more processes
  void _loadMoreProcesses() {
    setState(() {
      _displayedCount += 10;
    });
  }

  // Method to check if there are more processes to load
  bool _hasMoreProcesses(List<Process> processes) {
    final sortedProcesses = _getSortedProcesses(processes);
    return _displayedCount < sortedProcesses.length;
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
              // Clear processes and navigate to home
              final appProvider = Provider.of<AppProvider>(context, listen: false);
              appProvider.clearProcesses();
              Navigator.popUntil(context, (route) => route.isFirst);
            },
          ),
        ],
      ),
      body: Consumer<AppProvider>(
        builder: (context, appProvider, child) {
          // Reset pagination if processes have changed
          _resetPaginationIfNeeded(appProvider.processes);
          return SingleChildScrollView(
            padding: const EdgeInsets.all(12.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Selected Machine Info - only show when no processes found
                if (appProvider.selectedMachine != null && appProvider.processes.isEmpty) ...[
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
                  const SizedBox(height: 12),
                ],

                // Job Card Info - only show when no processes found
                if (appProvider.processes.isEmpty) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.green.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.green.shade200),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Job Card Content No',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: Colors.green,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        widget.jobCardContentNo,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                ],

                // Processes List
                if (appProvider.processes.isNotEmpty) ...[
                  // Check if there are running processes
                  Builder(
                    builder: (context) {
                      print('[ProcessListScreen] ========== FILTERING PROCESSES ==========');
                      print('[ProcessListScreen] Total processes loaded: ${appProvider.processes.length}');
                      for (var i = 0; i < appProvider.processes.length; i++) {
                        final p = appProvider.processes[i];
                        print('[ProcessListScreen] [$i] FormNo: ${p.formNo}, ProcessName: ${p.processName}, Status: "${p.currentStatus}"');
                      }
                      
                      final runningProcesses = _getRunningProcesses(appProvider.processes, appProvider);
                      final nonRunningProcesses = _getNonRunningProcesses(appProvider.processes, appProvider);
                      
                      print('[ProcessListScreen] ========== FILTERING COMPLETE ==========');
                      
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Running processes section
                          if (runningProcesses.isNotEmpty) ...[
                            Row(
                              children: [
                                const Icon(Icons.play_circle, color: Colors.orange, size: 24),
                                const SizedBox(width: 8),
                                const Text(
                                  'Running Processes',
                                  style: TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.orange,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.orange.shade100,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    '${runningProcesses.length}',
                                    style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.orange.shade700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            ListView.builder(
                              key: ValueKey('running_process_list_${runningProcesses.length}'),
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              itemCount: runningProcesses.length,
                              itemBuilder: (context, index) {
                                final process = runningProcesses[index];
                                return Padding(
                                  key: ValueKey('running_process_card_${process.processId}_${process.jobBookingJobcardContentsId}'),
                                  padding: const EdgeInsets.only(bottom: 8.0),
                                  child: _ProcessCard(
                                    process: process, 
                                    index: index,
                                    formatPwoDate: _formatPwoDate,
                                    jobCardContentNo: widget.jobCardContentNo,
                                  ),
                                );
                              },
                            ),
                            const SizedBox(height: 20),
                          ],
                          
                          // Pending processes section
                          if (nonRunningProcesses.isNotEmpty) ...[
                            Row(
                              children: [
                                const Icon(Icons.pending, color: Colors.blue, size: 24),
                                const SizedBox(width: 8),
                                const Text(
                                  'Pending Processes',
                                  style: TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.blue,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.blue.shade100,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    '${_getDisplayedProcesses(nonRunningProcesses).length} of ${_getSortedProcesses(nonRunningProcesses).length}',
                                    style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.blue.shade700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            ListView.builder(
                              key: ValueKey('pending_process_list_${_getDisplayedProcesses(nonRunningProcesses).length}'),
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              itemCount: _getDisplayedProcesses(nonRunningProcesses).length,
                              itemBuilder: (context, index) {
                                final displayedProcesses = _getDisplayedProcesses(nonRunningProcesses);
                                final process = displayedProcesses[index];
                                return Padding(
                                  key: ValueKey('pending_process_card_${process.processId}_${process.jobBookingJobcardContentsId}'),
                                  padding: const EdgeInsets.only(bottom: 8.0),
                                  child: _ProcessCard(
                                    process: process, 
                                    index: index,
                                    formatPwoDate: _formatPwoDate,
                                    jobCardContentNo: widget.jobCardContentNo,
                                  ),
                                );
                              },
                            ),
                          ],
                        ],
                      );
                    },
                  ),
                  
                  // Load More Button for pending processes
                  Builder(
                    builder: (context) {
                      final nonRunningProcesses = _getNonRunningProcesses(appProvider.processes, appProvider);
                      if (_hasMoreProcesses(nonRunningProcesses)) {
                        return Column(
                          children: [
                            const SizedBox(height: 12),
                            Center(
                              child: ElevatedButton.icon(
                                onPressed: _loadMoreProcesses,
                                icon: const Icon(Icons.expand_more),
                                label: const Text('Load More'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.blue,
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(25),
                                  ),
                                  elevation: 3,
                                ),
                              ),
                            ),
                          ],
                        );
                      }
                      return const SizedBox.shrink();
                    },
                  ),
                ] else if (appProvider.isLoading) ...[
                  const Center(
                    child: Column(
                      children: [
                        CircularProgressIndicator(),
                        SizedBox(height: 16),
                        Text(
                          'Loading processes...',
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.grey,
                          ),
                        ),
                      ],
                    ),
                  ),
                ] else ...[
                  const Center(
                    child: Column(
                      children: [
                        Icon(
                          Icons.inbox,
                          size: 64,
                          color: Colors.grey,
                        ),
                        SizedBox(height: 16),
                        Text(
                          'No processes found',
                          style: TextStyle(
                            fontSize: 18,
                            color: Colors.grey,
                          ),
                        ),
                        Text(
                          'No pending processes for this job card',
                          style: TextStyle(
                            color: Colors.grey,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ProcessCard extends StatelessWidget {
  final Process process;
  final int index;
  final String Function(String) formatPwoDate;
  final String jobCardContentNo;

  const _ProcessCard({
    required this.process,
    required this.index,
    required this.formatPwoDate,
    required this.jobCardContentNo,
  });

  // Helper method to extract number after last underscore from FormNo
  String _extractFormNumber(String formNo) {
    final parts = formNo.split('_');
    if (parts.isNotEmpty) {
      return parts.last;
    }
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final Color bg = _cardBackgroundColor();
    final String formNumber = _extractFormNumber(process.formNo);
    
    return Card(
      margin: EdgeInsets.zero,
      elevation: 3,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
      child: Container(
        constraints: const BoxConstraints(minHeight: 180), // Use minHeight instead of fixed height
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          color: bg,
          border: Border.all(
            color: Colors.blue.shade100,
            width: 1,
          ),
        ),
         child: Padding(
           padding: const EdgeInsets.all(12.0),
           child: Column(
             crossAxisAlignment: CrossAxisAlignment.start,
             children: [
               // Header row: Index, Process name with form number, Action buttons
               Row(
                 children: [
                   Container(
                     width: 24,
                     height: 24,
                     decoration: BoxDecoration(
                       gradient: LinearGradient(
                         colors: [
                           Colors.blue.shade400,
                           Colors.blue.shade600,
                         ],
                       ),
                       borderRadius: BorderRadius.circular(12),
                     ),
                     child: Center(
                       child: Text(
                         '${index + 1}',
                         style: const TextStyle(
                           color: Colors.white,
                           fontSize: 12,
                           fontWeight: FontWeight.bold,
                         ),
                       ),
                     ),
                   ),
                   const SizedBox(width: 12),
                   Expanded(
                     child: Text(
                       formNumber.isNotEmpty ? '${process.processName} ($formNumber)' : process.processName,
                       style: const TextStyle(
                         fontSize: 16,
                         fontWeight: FontWeight.bold,
                         color: Colors.black87,
                       ),
                       maxLines: 1,
                       overflow: TextOverflow.ellipsis,
                     ),
                   ),
                   // Action buttons moved to top right
                     Consumer<AppProvider>(
                      builder: (context, appProvider, child) {
                        final isRunning = appProvider.isProcessRunning(
                          process.processId ?? 0,
                          process.jobBookingJobcardContentsId,
                          formNo: process.formNo,
                        );

                        if (!isRunning) {
                        // Check if paper is issued
                        final double? piq = process.paperIssuedQty;
                        final bool isPaperIssued = piq != null && piq > 0;
                         
                         if (!isPaperIssued) {
                           // Paper not issued - show unclickable button
                           return ElevatedButton.icon(
                             onPressed: null, // Makes the button unclickable
                             style: ElevatedButton.styleFrom(
                               backgroundColor: Colors.grey.shade300,
                               foregroundColor: Colors.grey.shade600,
                               disabledBackgroundColor: Colors.grey.shade300,
                               disabledForegroundColor: Colors.grey.shade600,
                               padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                               minimumSize: const Size(0, 0),
                               tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                             ),
                             icon: const Icon(Icons.block, size: 14),
                             label: const Text('Paper not issued', style: TextStyle(fontSize: 12)),
                           );
                         }
                         
                         // Start button (existing logic)
                         return ElevatedButton.icon(
                           onPressed: () async {
                             final int employeeId = appProvider.currentLedgerId ?? appProvider.currentUserId ?? 0;
                             final int processId = process.processId ?? 0;
                             final result = await appProvider.startProcess(
                               employeeId: employeeId,
                               processId: processId,
                               jobBookingJobCardContentsId: process.jobBookingJobcardContentsId,
                               jobCardFormNo: process.formNo,
                               jobCardContentNo: jobCardContentNo,
                             );
                             if (result.success && context.mounted) {
                               if (!result.isStatusOnly) {
                                 // Only show success message and navigate for actual successful operations
                                 ScaffoldMessenger.of(context).showSnackBar(
                                   const SnackBar(content: Text('Production started')),
                                 );
                                 // Navigate to running process screen
                                 Navigator.push(
                                   context,
                                   MaterialPageRoute(
                                     builder: (context) => RunningProcessScreen(
                                       process: process,
                                       jobCardContentNo: jobCardContentNo,
                                     ),
                                   ),
                                 );
                               }
                               // For status-only responses, dialog was already shown, just stay on current page
                             }
                           },
                           style: ElevatedButton.styleFrom(
                             backgroundColor: Colors.blue,
                             foregroundColor: Colors.white,
                             padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                             minimumSize: const Size(0, 0),
                             tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                           ),
                           icon: const Icon(Icons.play_arrow, size: 14),
                           label: const Text('Start', style: TextStyle(fontSize: 12)),
                         );
                       } else {
                         // Running state buttons -> replaced with a single "View Status" button
                         return ElevatedButton.icon(
                           onPressed: () {
                             Navigator.push(
                               context,
                               MaterialPageRoute(
                                 builder: (context) => RunningProcessScreen(
                                   process: process,
                                   jobCardContentNo: jobCardContentNo,
                                 ),
                               ),
                             );
                           },
                           style: ElevatedButton.styleFrom(
                             backgroundColor: Colors.orange,
                             foregroundColor: Colors.white,
                             padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                             minimumSize: const Size(0, 0),
                             tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                           ),
                           icon: const Icon(Icons.visibility, size: 12),
                           label: const Text('View Status', style: TextStyle(fontSize: 10)),
                         );
                       }
                     },
                   ),
                 ],
               ),
               
               const SizedBox(height: 12),
               
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
                           value: process.client,
                           iconColor: Colors.blue,
                         ),
                         const SizedBox(height: 4),
                         _InfoRow(
                           icon: Icons.work,
                           label: 'Job',
                           value: process.jobName,
                           iconColor: Colors.green,
                         ),
                         const SizedBox(height: 4),
                         _InfoRow(
                           icon: Icons.inventory,
                           label: 'Component',
                           value: process.componentName,
                           iconColor: Colors.orange,
                         ),
                         const SizedBox(height: 8),
                         // Quantities in the same column
                         Row(
                           children: [
                             _QuantityBadge(
                               label: 'Schedule',
                               value: process.scheduleQty,
                               color: Colors.green,
                             ),
                             const SizedBox(width: 8),
                             _QuantityBadge(
                               label: 'Produced',
                               value: process.qtyProduced,
                               color: Colors.orange,
                             ),
                           ],
                         ),
                       ],
                     ),
                   ),
                   
                   const SizedBox(width: 12),
                   
                   // Right column - PWO and Form only (removed Date)
                   Expanded(
                     child: Column(
                       crossAxisAlignment: CrossAxisAlignment.start,
                       mainAxisSize: MainAxisSize.min,
                       children: [
                         _InfoRow(
                           icon: Icons.receipt,
                           label: 'PWO',
                           value: process.pwoNo,
                           iconColor: Colors.purple,
                         ),
                         const SizedBox(height: 4),
                         _InfoRow(
                           icon: Icons.description,
                           label: 'Form',
                           value: process.formNo,
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
    );
  }

  Color _cardBackgroundColor() {
    final double? piq = process.paperIssuedQty;
    if (piq == null || piq == 0) return Colors.grey.shade400; // Light Grey
    final String status = (process.currentStatus ?? '').trim();
    if (status == 'In Queue') return Colors.green.shade100;
    if (status == 'Part Complete') return Colors.orange.shade100;
    return Colors.white;
  }

  Widget _statusChip() {
    final String status = (process.currentStatus ?? '').trim();
    Color color;
    if (status == 'In Queue') {
      color = Colors.green;
    } else if (status == 'Part Complete') {
      color = Colors.orange;
    } else {
      color = Colors.blueGrey;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        status.isEmpty ? 'Status' : status,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _CompactInfoRow(String label, String value, IconData icon, Color color) {
    return Row(
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(
            color: color.withOpacity(0.2),
            borderRadius: BorderRadius.circular(2),
          ),
          child: Icon(
            icon,
            size: 6,
            color: color,
          ),
        ),
        const SizedBox(width: 3),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              fontSize: 7,
              color: Colors.black87,
              fontWeight: FontWeight.w500,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  Widget _CompactQuantityBadge(String label, int value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withOpacity(0.3), width: 0.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '$label: ',
            style: TextStyle(
              fontSize: 6,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
          Text(
            value.toString(),
            style: TextStyle(
              fontSize: 8,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _UltraCompactBadge(String label, int value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withOpacity(0.4), width: 0.5),
      ),
      child: Text(
        '$label: $value',
        style: TextStyle(
          fontSize: 8,
          fontWeight: FontWeight.bold,
          color: color,
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
          width: 12,
          height: 12,
          decoration: BoxDecoration(
            color: iconColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(2),
          ),
          child: Icon(
            icon,
            size: 7,
            color: iconColor,
          ),
        ),
        const SizedBox(width: 4),
        Expanded(
          child: RichText(
            text: TextSpan(
              style: TextStyle(
                fontSize: 8,
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
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.3), width: 1),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 7,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
          const SizedBox(height: 1),
          Text(
            value.toString(),
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _CompactInfo extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color color;

  const _CompactInfo({
    required this.icon,
    required this.text,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.3), width: 0.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 10,
            color: color,
          ),
          const SizedBox(width: 3),
          Flexible(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 9,
                color: color,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: Colors.blue.shade100,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Icon(
            icon,
            size: 16,
            color: Colors.blue.shade700,
          ),
        ),
        const SizedBox(width: 12),
        Text(
          '$label: ',
          style: TextStyle(
            fontSize: 14,
            color: Colors.grey.shade700,
            fontWeight: FontWeight.w500,
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: Colors.black87,
            ),
          ),
        ),
      ],
    );
  }
}

