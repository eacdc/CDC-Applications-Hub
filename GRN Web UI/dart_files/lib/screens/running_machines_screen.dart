import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_provider.dart';
import '../models/machine_status.dart';

class RunningMachinesScreen extends StatefulWidget {
  const RunningMachinesScreen({super.key});

  @override
  State<RunningMachinesScreen> createState() => _RunningMachinesScreenState();
}

class _RunningMachinesScreenState extends State<RunningMachinesScreen> {
  List<MachineStatus> _machineStatuses = [];
  bool _isLoading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadMachineStatuses();
  }

  Future<void> _loadMachineStatuses() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final appProvider = Provider.of<AppProvider>(context, listen: false);
      final result = await appProvider.getLatestMachineStatusPerMachine();
      
      if (result.status) {
        setState(() {
          _machineStatuses = result.data ?? [];
          _isLoading = false;
        });
      } else {
        setState(() {
          _error = result.error ?? 'Failed to load machine statuses';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Error loading machine statuses: $e';
        _isLoading = false;
      });
    }
  }

  List<MachineStatus> get _runningMachines {
    return _machineStatuses.where((status) => 
      status.machineStatus.toLowerCase() == 'running'
    ).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Running Machines'),
        backgroundColor: Colors.orange,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadMachineStatuses,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Loading running machines...'),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline,
              size: 64,
              color: Colors.red.shade300,
            ),
            const SizedBox(height: 16),
            Text(
              'Error',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Colors.red.shade700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _error!,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.red.shade600,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _loadMachineStatuses,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    final runningMachines = _runningMachines;

    if (runningMachines.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.play_circle_outline,
              size: 64,
              color: Colors.grey.shade400,
            ),
            const SizedBox(height: 16),
            Text(
              'No Running Machines',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Colors.grey.shade600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'All machines are currently idle',
              style: TextStyle(
                color: Colors.grey.shade500,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _loadMachineStatuses,
              icon: const Icon(Icons.refresh),
              label: const Text('Refresh'),
            ),
          ],
        ),
      );
    }

    return Column(
      children: [
        // Header with count
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.orange.shade50,
            border: Border(
              bottom: BorderSide(color: Colors.orange.shade200),
            ),
          ),
          child: Row(
            children: [
              Icon(
                Icons.play_circle,
                color: Colors.orange.shade600,
                size: 24,
              ),
              const SizedBox(width: 12),
              Text(
                '${runningMachines.length} Machine${runningMachines.length == 1 ? '' : 's'} Running',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Colors.orange.shade700,
                ),
              ),
            ],
          ),
        ),
        
        // List of running machines
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: runningMachines.length,
            itemBuilder: (context, index) {
              final status = runningMachines[index];
              return _MachineStatusCard(status: status);
            },
          ),
        ),
      ],
    );
  }
}

class _MachineStatusCard extends StatelessWidget {
  final MachineStatus status;

  const _MachineStatusCard({required this.status});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: Colors.orange.shade200,
            width: 1,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row with machine name and status
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: Colors.orange.shade100,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(
                      Icons.precision_manufacturing,
                      color: Colors.orange.shade600,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          status.machineName,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: Colors.black87,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.orange.shade100,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            'Running',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: Colors.orange.shade700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              
              const SizedBox(height: 16),
              
              // Job details
              _InfoRow(
                icon: Icons.work,
                label: 'Job',
                value: status.jobName,
                iconColor: Colors.blue,
              ),
              const SizedBox(height: 8),
              _InfoRow(
                icon: Icons.description,
                label: 'Job Number',
                value: status.jobNumber,
                iconColor: Colors.green,
              ),
              const SizedBox(height: 8),
              _InfoRow(
                icon: Icons.settings,
                label: 'Process',
                value: status.process,
                iconColor: Colors.purple,
              ),
              const SizedBox(height: 8),
              _InfoRow(
                icon: Icons.access_time,
                label: 'Last Updated',
                value: status.lastUpdated,
                iconColor: Colors.grey,
              ),
            ],
          ),
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
          width: 20,
          height: 20,
          decoration: BoxDecoration(
            color: iconColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Icon(
            icon,
            size: 12,
            color: iconColor,
          ),
        ),
        const SizedBox(width: 8),
        Text(
          '$label: ',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: Colors.grey.shade600,
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: Colors.black87,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
