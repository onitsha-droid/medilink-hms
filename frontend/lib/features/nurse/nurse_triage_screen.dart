import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';

// ── Vitals form data ──────────────────────────────────────────────────────────

class VitalsFormData {
  VitalsFormData({
    this.bpSystolic,
    this.bpDiastolic,
    this.spo2,
    this.weightKg,
    this.temperatureCelsius,
    this.heartRateBpm,
    this.notes,
    this.isUrgent = false,
    this.urgentReason,
  });

  double? bpSystolic;
  double? bpDiastolic;
  double? spo2;
  double? weightKg;
  double? temperatureCelsius;
  double? heartRateBpm;
  String? notes;
  bool isUrgent;
  String? urgentReason;

  Map<String, dynamic> toJson() => {
        if (bpSystolic != null) 'bpSystolic': bpSystolic,
        if (bpDiastolic != null) 'bpDiastolic': bpDiastolic,
        if (spo2 != null) 'spo2': spo2,
        if (weightKg != null) 'weightKg': weightKg,
        if (temperatureCelsius != null) 'temperatureCelsius': temperatureCelsius,
        if (heartRateBpm != null) 'heartRateBpm': heartRateBpm,
        if (notes != null && notes!.isNotEmpty) 'notes': notes,
        'isUrgent': isUrgent,
        if (urgentReason != null && urgentReason!.isNotEmpty)
          'urgentReason': urgentReason,
      };
}

// ── Repository ────────────────────────────────────────────────────────────────

final vitalsRepositoryProvider = Provider<VitalsRepository>((ref) {
  return VitalsRepository(ref.read(apiClientProvider));
});

class VitalsRepository {
  const VitalsRepository(this._api);
  final ApiClient _api;

  Future<Map<String, dynamic>> recordVitals(
      String queueEntryId, VitalsFormData data) async {
    final res = await _api.dio.post<Map<String, dynamic>>(
      '/vitals/$queueEntryId',
      data: data.toJson(),
    );
    return res.data!;
  }

  Future<List<dynamic>> getTriageQueue(String clinicId) async {
    final res = await _api.dio
        .get<Map<String, dynamic>>('/vitals/triage-queue/$clinicId');
    return res.data!['triageQueue'] as List<dynamic>;
  }
}

// ── Vitals Form Screen ────────────────────────────────────────────────────────

class VitalsFormScreen extends ConsumerStatefulWidget {
  const VitalsFormScreen({
    super.key,
    required this.queueEntryId,
    required this.patientName,
  });

  final String queueEntryId;
  final String patientName;

  @override
  ConsumerState<VitalsFormScreen> createState() => _VitalsFormScreenState();
}

class _VitalsFormScreenState extends ConsumerState<VitalsFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _data = VitalsFormData();

  final _systolicCtrl = TextEditingController();
  final _diastolicCtrl = TextEditingController();
  final _spo2Ctrl = TextEditingController();
  final _weightCtrl = TextEditingController();
  final _tempCtrl = TextEditingController();
  final _hrCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  final _urgentReasonCtrl = TextEditingController();

  bool _loading = false;
  bool _submitted = false;
  String? _error;
  bool _autoUrgent = false;

  @override
  void dispose() {
    _systolicCtrl.dispose();
    _diastolicCtrl.dispose();
    _spo2Ctrl.dispose();
    _weightCtrl.dispose();
    _tempCtrl.dispose();
    _hrCtrl.dispose();
    _notesCtrl.dispose();
    _urgentReasonCtrl.dispose();
    super.dispose();
  }

  void _checkAutoUrgent() {
    final spo2 = double.tryParse(_spo2Ctrl.text);
    final sys = double.tryParse(_systolicCtrl.text);
    final temp = double.tryParse(_tempCtrl.text);
    final hr = double.tryParse(_hrCtrl.text);

    final urgent = (spo2 != null && spo2 < 92) ||
        (sys != null && (sys > 180 || sys < 80)) ||
        (temp != null && (temp > 39.5 || temp < 35)) ||
        (hr != null && (hr > 150 || hr < 40));

    if (urgent != _autoUrgent) setState(() => _autoUrgent = urgent);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    _data
      ..bpSystolic = double.tryParse(_systolicCtrl.text)
      ..bpDiastolic = double.tryParse(_diastolicCtrl.text)
      ..spo2 = double.tryParse(_spo2Ctrl.text)
      ..weightKg = double.tryParse(_weightCtrl.text)
      ..temperatureCelsius = double.tryParse(_tempCtrl.text)
      ..heartRateBpm = double.tryParse(_hrCtrl.text)
      ..notes =
          _notesCtrl.text.trim().isEmpty ? null : _notesCtrl.text.trim()
      ..urgentReason = _urgentReasonCtrl.text.trim().isEmpty
          ? null
          : _urgentReasonCtrl.text.trim();

    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref
          .read(vitalsRepositoryProvider)
          .recordVitals(widget.queueEntryId, _data);
      setState(() {
        _loading = false;
        _submitted = true;
      });
    } catch (e) {
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_submitted) {
      return _SuccessScreen(patientName: widget.patientName);
    }

    return Scaffold(
      appBar: AppBar(title: Text('Vitals — ${widget.patientName}')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ── Auto-urgent warning ───────────────────────────────────────
            if (_autoUrgent)
              Container(
                key: const Key('auto_urgent_warning'),
                margin: const EdgeInsets.only(bottom: 16),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.red.shade300),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.warning_amber, color: Colors.red),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Critical values detected — patient will be auto-flagged as URGENT.',
                        style: TextStyle(color: Colors.red),
                      ),
                    ),
                  ],
                ),
              ),

            _SectionHeader('Blood Pressure (mmHg)'),
            Row(
              children: [
                Expanded(
                  child: _VitalsField(
                    key: const Key('bp_systolic_field'),
                    controller: _systolicCtrl,
                    label: 'Systolic',
                    hint: '60–250',
                    min: 50,
                    max: 300,
                    onChanged: (_) => _checkAutoUrgent(),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _VitalsField(
                    key: const Key('bp_diastolic_field'),
                    controller: _diastolicCtrl,
                    label: 'Diastolic',
                    hint: '40–130',
                    min: 20,
                    max: 200,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            _SectionHeader('Oxygen Saturation'),
            _VitalsField(
              key: const Key('spo2_field'),
              controller: _spo2Ctrl,
              label: 'SpO2 (%)',
              hint: '95–100',
              min: 50,
              max: 100,
              onChanged: (_) => _checkAutoUrgent(),
            ),
            const SizedBox(height: 16),

            _SectionHeader('Temperature'),
            _VitalsField(
              key: const Key('temperature_field'),
              controller: _tempCtrl,
              label: 'Temperature (°C)',
              hint: '36–37.5',
              min: 30,
              max: 45,
              onChanged: (_) => _checkAutoUrgent(),
            ),
            const SizedBox(height: 16),

            _SectionHeader('Weight & Heart Rate'),
            Row(
              children: [
                Expanded(
                  child: _VitalsField(
                    key: const Key('weight_field'),
                    controller: _weightCtrl,
                    label: 'Weight (kg)',
                    hint: '1–200',
                    min: 0.5,
                    max: 500,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _VitalsField(
                    key: const Key('heart_rate_field'),
                    controller: _hrCtrl,
                    label: 'Heart Rate (bpm)',
                    hint: '60–100',
                    min: 20,
                    max: 300,
                    onChanged: (_) => _checkAutoUrgent(),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            _SectionHeader('Notes'),
            TextFormField(
              key: const Key('vitals_notes_field'),
              controller: _notesCtrl,
              maxLines: 3,
              maxLength: 1000,
              decoration: const InputDecoration(
                labelText: 'Clinical notes (optional)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),

            // ── Manual urgent toggle ──────────────────────────────────────
            SwitchListTile(
              key: const Key('urgent_toggle'),
              value: _data.isUrgent || _autoUrgent,
              onChanged: (v) => setState(() => _data.isUrgent = v),
              title: const Text('Flag as Urgent'),
              subtitle: const Text('Moves patient to front of queue'),
              activeColor: Colors.red,
            ),
            if (_data.isUrgent || _autoUrgent)
              TextFormField(
                key: const Key('urgent_reason_field'),
                controller: _urgentReasonCtrl,
                decoration: const InputDecoration(
                  labelText: 'Reason for urgency',
                  border: OutlineInputBorder(),
                ),
                validator: (v) {
                  if (_data.isUrgent &&
                      (v == null || v.trim().isEmpty)) {
                    return 'Please provide a reason for the urgent flag';
                  }
                  return null;
                },
              ),
            const SizedBox(height: 24),

            if (_error != null)
              Container(
                key: const Key('vitals_error_banner'),
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.red.shade200),
                ),
                child: Text(_error!,
                    style: TextStyle(color: Colors.red.shade800)),
              ),

            FilledButton(
              key: const Key('submit_vitals_button'),
              onPressed: _loading ? null : _submit,
              child: _loading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Save Vitals'),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Nurse Triage Queue Screen ─────────────────────────────────────────────────

class NurseTriageQueueScreen extends ConsumerStatefulWidget {
  const NurseTriageQueueScreen({super.key, required this.clinicId});
  final String clinicId;

  @override
  ConsumerState<NurseTriageQueueScreen> createState() =>
      _NurseTriageQueueScreenState();
}

class _NurseTriageQueueScreenState
    extends ConsumerState<NurseTriageQueueScreen> {
  List<dynamic>? _queue;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadQueue();
  }

  Future<void> _loadQueue() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final queue = await ref
          .read(vitalsRepositoryProvider)
          .getTriageQueue(widget.clinicId);
      setState(() {
        _queue = queue;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Triage Queue'),
        actions: [
          IconButton(
            key: const Key('refresh_triage_button'),
            icon: const Icon(Icons.refresh),
            onPressed: _loadQueue,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(
          key: Key('triage_loading'),
          child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        key: const Key('triage_error'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Colors.red, size: 48),
            const SizedBox(height: 12),
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: _loadQueue, child: const Text('Retry')),
          ],
        ),
      );
    }
    if (_queue == null || _queue!.isEmpty) {
      return const Center(
        key: Key('triage_empty'),
        child: Text('No patients in the queue yet.'),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadQueue,
      child: ListView.separated(
        itemCount: _queue!.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final item = _queue![index] as Map<String, dynamic>;
          final entry = item['entry'] as Map<String, dynamic>;
          final patient =
              entry['patient'] as Map<String, dynamic>? ?? {};
          final vitalsRecorded =
              item['vitalsRecorded'] as bool? ?? false;
          final isUrgent = entry['isUrgent'] as bool? ?? false;
          final position = item['position'] as int? ?? index + 1;
          final wait = item['estimatedWaitMinutes'] as int? ?? 0;
          final name =
              '${patient['firstName'] ?? ''} ${patient['lastName'] ?? ''}'
                  .trim();

          return ListTile(
            key: Key('triage_entry_$index'),
            leading: CircleAvatar(
              backgroundColor:
                  isUrgent ? Colors.red.shade100 : Colors.blue.shade50,
              child: Text(
                '$position',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: isUrgent ? Colors.red : Colors.blue,
                ),
              ),
            ),
            title: Row(
              children: [
                Text(name.isEmpty ? 'Unknown' : name),
                if (isUrgent) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.red,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text('URGENT',
                        style: TextStyle(
                            color: Colors.white, fontSize: 10)),
                  ),
                ],
              ],
            ),
            subtitle: Text(
              vitalsRecorded
                  ? 'Vitals recorded ✓'
                  : 'Est. wait: ${wait == 0 ? "Next" : "~$wait min"}',
            ),
            trailing: vitalsRecorded
                ? const Icon(Icons.check_circle, color: Colors.green)
                : FilledButton(
                    key: Key('record_vitals_button_$index'),
                    onPressed: () => Navigator.of(context)
                        .push(
                          MaterialPageRoute<void>(
                            builder: (_) => VitalsFormScreen(
                              queueEntryId:
                                  entry['_id']?.toString() ?? '',
                              patientName:
                                  name.isEmpty ? 'Patient' : name,
                            ),
                          ),
                        )
                        .then((_) => _loadQueue()),
                    child: const Text('Vitals'),
                  ),
          );
        },
      ),
    );
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: Theme.of(context)
            .textTheme
            .labelLarge
            ?.copyWith(color: Colors.grey.shade700),
      ),
    );
  }
}

class _VitalsField extends StatelessWidget {
  const _VitalsField({
    super.key,
    required this.controller,
    required this.label,
    required this.hint,
    required this.min,
    required this.max,
    this.onChanged,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final double min;
  final double max;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType:
          const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: const OutlineInputBorder(),
      ),
      onChanged: onChanged,
      validator: (v) {
        if (v == null || v.trim().isEmpty) return null; // optional
        final val = double.tryParse(v.trim());
        if (val == null) return 'Must be a number';
        if (val < min || val > max) return '$label must be $min–$max';
        return null;
      },
    );
  }
}

class _SuccessScreen extends StatelessWidget {
  const _SuccessScreen({required this.patientName});
  final String patientName;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Vitals Saved')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle, color: Colors.green, size: 72),
            const SizedBox(height: 16),
            Text(
              'Vitals recorded for $patientName',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 24),
            FilledButton(
              key: const Key('back_to_triage_button'),
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Back to Triage Queue'),
            ),
          ],
        ),
      ),
    );
  }
}
