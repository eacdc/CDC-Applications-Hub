import 'package:flutter/material.dart';

class StatusWarningDialog extends StatelessWidget {
  final String statusMessage;
  final String statusValue;

  const StatusWarningDialog({
    super.key,
    required this.statusMessage,
    required this.statusValue,
  });

  @override
  Widget build(BuildContext context) {
    return WillPopScope(
      onWillPop: () async => false, // Prevent back button from dismissing dialog
      child: AlertDialog(
      title: Row(
        children: [
          Icon(
            Icons.warning_amber_rounded,
            color: Colors.orange[700],
            size: 28,
          ),
          const SizedBox(width: 12),
          const Text(
            'Status Warning',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'The operation returned a status message:',
            style: TextStyle(
              fontSize: 16,
              color: Colors.black87,
            ),
          ),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.orange[50],
              border: Border.all(color: Colors.orange[300]!),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              statusValue,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: Colors.orange[800],
              ),
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'Please review this status and take appropriate action if needed.',
            style: TextStyle(
              fontSize: 14,
              color: Colors.black54,
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () {
            print('[StatusWarningDialog] User clicked OK, closing dialog');
            Navigator.of(context).pop();
          },
          style: TextButton.styleFrom(
            backgroundColor: Colors.orange[100],
            foregroundColor: Colors.orange[800],
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          ),
          child: const Text(
            'OK',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
      ),
    );
  }

  static Future<void> show(BuildContext context, String statusMessage, String statusValue) async {
    print('[StatusWarningDialog] Showing status warning: $statusValue');
    await showDialog<void>(
      context: context,
      barrierDismissible: false, // Prevent dismissing by tapping outside
      builder: (context) => StatusWarningDialog(
        statusMessage: statusMessage,
        statusValue: statusValue,
      ),
    );
    print('[StatusWarningDialog] Dialog dismissed, continuing flow');
  }
}
