import 'package:flutter/material.dart';
import 'dart:async';

class ProductionTimer extends StatefulWidget {
  final DateTime startTime;
  final Color? color;

  const ProductionTimer({
    super.key,
    required this.startTime,
    this.color,
  });

  @override
  State<ProductionTimer> createState() => _ProductionTimerState();
}

class _ProductionTimerState extends State<ProductionTimer> {
  Timer? _timer;
  Duration _elapsed = Duration.zero;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _updateElapsed();
        _timer = Timer.periodic(const Duration(seconds: 1), (_) {
          if (mounted) {
            _updateElapsed();
          }
        });
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _timer = null;
    super.dispose();
  }

  void _updateElapsed() {
    if (mounted && _timer != null) {
      setState(() {
        _elapsed = DateTime.now().difference(widget.startTime);
      });
    }
  }

  String _formatDuration(Duration duration) {
    final hours = duration.inHours;
    final minutes = duration.inMinutes.remainder(60);
    final seconds = duration.inSeconds.remainder(60);
    
    if (hours > 0) {
      return '${hours.toString().padLeft(2, '0')}:${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
    } else {
      return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey('timer_${widget.startTime.millisecondsSinceEpoch}'),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: (widget.color ?? Colors.green).withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: (widget.color ?? Colors.green).withOpacity(0.3), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.timer,
            size: 10,
            color: widget.color ?? Colors.green,
          ),
          const SizedBox(width: 3),
          Text(
            _formatDuration(_elapsed),
            style: TextStyle(
              fontSize: 9,
              fontWeight: FontWeight.bold,
              color: widget.color ?? Colors.green,
            ),
          ),
        ],
      ),
    );
  }
}
