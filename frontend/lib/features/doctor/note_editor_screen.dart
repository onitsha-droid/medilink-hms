import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/clinical_models.dart';
import '../../core/providers/clinical_repository.dart';

/// Note + Diagnosis editor used by the Doctor.
/// Renders a SOAP-format form and submits to POST /encounters/:id/notes
/// and optionally PATCH /encounters/:id/diagnosis.
class NoteEditorScreen extends ConsumerStatefulWidget {
  const NoteEditorScreen({
    super.key,
    required this.encounterId,
    required this.patientName,
  });

  final String encounterId;
  final String patientName;

  @override
  ConsumerState<NoteEditorScreen> createState() =>
      _NoteEditorScreenState();
}

class _NoteEditorScreenState extends ConsumerState<NoteEditorScreen> {
  final _formKey = GlobalKey<FormState>();
  final _subjCtrl = TextEditingController();
  final _objCtrl = TextEditingController();
  final _assessCtrl = TextEditingController();
  final _planCtrl = TextEditingController();
  final _dxCodeCtrl = TextEditingController();
  final _dxDescCtrl = TextEditingController();

  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _subjCtrl.dispose();
    _objCtrl.dispose();
    _assessCtrl.dispose();
    _planCtrl.dispose();
    _dxCodeCtrl.dispose();
    _dxDescCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _saving = true;
      _error = null;
    });

    final repo = ref.read(clinicalRepositoryProvider);

    try {
      // Build diagnosis if provided
      DiagnosisEntry? diagnosis;
      if (_dxDescCtrl.text.trim().isNotEmpty) {
        diagnosis = DiagnosisEntry(
          code: _dxCodeCtrl.text.trim().isEmpty
              ? null
              : _dxCodeCtrl.text.trim(),
          description: _dxDescCtrl.text.trim(),
        );
      }

      await repo.addNote(
        encounterId: widget.encounterId,
        subjective: _subjCtrl.text.trim(),
        objective: _objCtrl.text.trim(),
        assessment: _assessCtrl.text.trim(),
        plan: _planCtrl.text.trim(),
        diagnosis: diagnosis,
      );

      // Separately update encounter diagnosis for primary record
      if (diagnosis != null) {
        await repo.setDiagnosis(
          encounterId: widget.encounterId,
          primary: diagnosis,
        );
      }

      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Note — ${widget.patientName}'),
        actions: [
          if (_saving)
            const Padding(
              padding: EdgeInsets.all(16),
              child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white)),
            )
          else
            TextButton(
              onPressed: _submit,
              child: const Text('SAVE',
                  style: TextStyle(color: Colors.white)),
            ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!,
                    style: const TextStyle(color: Colors.red)),
              ),
            _SoapField(
              controller: _subjCtrl,
              label: 'Subjective',
              hint: "Patient's complaints in their own words",
            ),
            const SizedBox(height: 12),
            _SoapField(
              controller: _objCtrl,
              label: 'Objective',
              hint: 'Examination findings',
            ),
            const SizedBox(height: 12),
            _SoapField(
              controller: _assessCtrl,
              label: 'Assessment',
              hint: 'Clinical interpretation',
            ),
            const SizedBox(height: 12),
            _SoapField(
              controller: _planCtrl,
              label: 'Plan',
              hint: 'Treatment, referrals, follow-up',
            ),
            const SizedBox(height: 20),
            Text('Diagnosis (optional)',
                style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            Row(
              children: [
                SizedBox(
                  width: 100,
                  child: TextFormField(
                    controller: _dxCodeCtrl,
                    decoration: const InputDecoration(
                      labelText: 'ICD code',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _dxDescCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Description',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SoapField extends StatelessWidget {
  const _SoapField({
    required this.controller,
    required this.label,
    required this.hint,
  });

  final TextEditingController controller;
  final String label;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      minLines: 3,
      maxLines: 8,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        alignLabelWithHint: true,
        border: const OutlineInputBorder(),
      ),
    );
  }
}
