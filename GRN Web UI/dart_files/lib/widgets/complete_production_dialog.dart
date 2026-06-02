import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class CompleteProductionDialog extends StatefulWidget {
  final int scheduleQty;
  final Function(int productionQty, int wastageQty) onSubmit;

  const CompleteProductionDialog({
    super.key,
    required this.scheduleQty,
    required this.onSubmit,
  });

  @override
  State<CompleteProductionDialog> createState() => _CompleteProductionDialogState();
}

class _CompleteProductionDialogState extends State<CompleteProductionDialog> {
  final _formKey = GlobalKey<FormState>();
  final _productionQtyController = TextEditingController();
  final _wastageQtyController = TextEditingController();
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    // Pre-fill production qty with schedule qty
    _productionQtyController.text = widget.scheduleQty.toString();
    _wastageQtyController.text = '0';
  }

  @override
  void dispose() {
    _productionQtyController.dispose();
    _wastageQtyController.dispose();
    super.dispose();
  }

  void _handleSubmit() async {
    if (_formKey.currentState!.validate() && !_isSubmitting) {
      setState(() {
        _isSubmitting = true;
      });
      
      final productionQty = int.tryParse(_productionQtyController.text) ?? 0;
      final wastageQty = int.tryParse(_wastageQtyController.text) ?? 0;
      
      await widget.onSubmit(productionQty, wastageQty);
      
      if (mounted) {
        Navigator.of(context).pop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return WillPopScope(
      onWillPop: () async => !_isSubmitting,
      child: AlertDialog(
        title: const Text(
          'Complete Production',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: Colors.blue,
          ),
        ),
        content: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_isSubmitting) ...[
                const CircularProgressIndicator(),
                const SizedBox(height: 16),
                const Text(
                  'Processing...',
                  style: TextStyle(
                    fontSize: 14,
                    color: Colors.grey,
                  ),
                ),
              ] else ...[
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
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  enabled: !_isSubmitting,
                  decoration: InputDecoration(
                    labelText: 'Production Qty',
                    hintText: 'Enter produced quantity',
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
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  enabled: !_isSubmitting,
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
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: _isSubmitting ? null : () => Navigator.of(context).pop(),
            child: const Text(
              'Cancel',
              style: TextStyle(color: Colors.grey),
            ),
          ),
          ElevatedButton(
            onPressed: _isSubmitting ? null : _handleSubmit,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.green,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: _isSubmitting
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  )
                : const Text(
                    'Submit',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
          ),
        ],
      ),
    );
  }
}
