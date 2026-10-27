import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/api_client.dart';
import '../api/clinical_models.dart';

/// Central repository for all clinical endpoints.
/// Screens call methods here; providers hold the async state.
final clinicalRepositoryProvider = Provider<ClinicalRepository>((ref) {
  return ClinicalRepository(ref.read(apiClientProvider));
});

class ClinicalRepository {
  const ClinicalRepository(this._api);
  final ApiClient _api;

  // ── Encounters ─────────────────────────────────────────────────────────────

  Future<List<Encounter>> getMyQueue() async {
    final res =
        await _api.dio.get<Map<String, dynamic>>('/encounters/my-queue');
    return (res.data!['encounters'] as List)
        .map((e) => Encounter.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<Map<String, dynamic>> getPatientHistory(String patientId) async {
    final res = await _api.dio
        .get<Map<String, dynamic>>('/encounters/patient/$patientId/history');
    final data = res.data!;
    return {
      'encounters': (data['encounters'] as List)
          .map((e) =>
              Encounter.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
      'notes': (data['notes'] as List)
          .map((n) =>
              ClinicalNote.fromJson(Map<String, dynamic>.from(n as Map)))
          .toList(),
      'vitals': (data['vitals'] as List)
          .map((v) =>
              VitalsRecord.fromJson(Map<String, dynamic>.from(v as Map)))
          .toList(),
    };
  }

  Future<Encounter> openEncounter({
    required String patientId,
    required String clinicId,
    String? chiefComplaint,
  }) async {
    final res = await _api.dio.post<Map<String, dynamic>>(
      '/encounters',
      data: {
        'patientId': patientId,
        'clinicId': clinicId,
        if (chiefComplaint != null && chiefComplaint.isNotEmpty)
          'chiefComplaint': chiefComplaint,
      },
    );
    return Encounter.fromJson(
        Map<String, dynamic>.from(res.data!['encounter'] as Map));
  }

  Future<ClinicalNote> addNote({
    required String encounterId,
    String? subjective,
    String? objective,
    String? assessment,
    String? plan,
    DiagnosisEntry? diagnosis,
  }) async {
    final res = await _api.dio.post<Map<String, dynamic>>(
      '/encounters/$encounterId/notes',
      data: {
        if (subjective != null && subjective.isNotEmpty) 'subjective': subjective,
        if (objective != null && objective.isNotEmpty) 'objective': objective,
        if (assessment != null && assessment.isNotEmpty) 'assessment': assessment,
        if (plan != null && plan.isNotEmpty) 'plan': plan,
        if (diagnosis != null) 'diagnosis': diagnosis.toJson(),
      },
    );
    return ClinicalNote.fromJson(
        Map<String, dynamic>.from(res.data!['note'] as Map));
  }

  Future<Encounter> setDiagnosis({
    required String encounterId,
    required DiagnosisEntry primary,
  }) async {
    final res = await _api.dio.patch<Map<String, dynamic>>(
      '/encounters/$encounterId/diagnosis',
      data: {'primaryDiagnosis': primary.toJson()},
    );
    return Encounter.fromJson(
        Map<String, dynamic>.from(res.data!['encounter'] as Map));
  }

  Future<Encounter> completeEncounter(String encounterId) async {
    final res = await _api.dio.patch<Map<String, dynamic>>(
      '/encounters/$encounterId/complete',
    );
    return Encounter.fromJson(
        Map<String, dynamic>.from(res.data!['encounter'] as Map));
  }

  // ── Lab Requests ───────────────────────────────────────────────────────────

  Future<LabRequest> createLabRequest({
    required String encounterId,
    required List<Map<String, dynamic>> tests,
    String urgency = 'routine',
    String? clinicalNote,
  }) async {
    final res = await _api.dio.post<Map<String, dynamic>>(
      '/lab-requests',
      data: {
        'encounterId': encounterId,
        'tests': tests,
        'urgency': urgency,
        if (clinicalNote != null) 'clinicalNote': clinicalNote,
      },
    );
    return LabRequest.fromJson(
        Map<String, dynamic>.from(res.data!['labRequest'] as Map));
  }

  Future<List<LabRequest>> getLabWorklist() async {
    final res = await _api.dio
        .get<Map<String, dynamic>>('/lab-requests/worklist');
    return (res.data!['labRequests'] as List)
        .map((r) =>
            LabRequest.fromJson(Map<String, dynamic>.from(r as Map)))
        .toList();
  }

  Future<LabRequest> pickUpLabRequest(String labRequestId) async {
    final res = await _api.dio.patch<Map<String, dynamic>>(
      '/lab-requests/$labRequestId/pick-up',
    );
    return LabRequest.fromJson(
        Map<String, dynamic>.from(res.data!['labRequest'] as Map));
  }

  Future<LabRequest> submitLabResults({
    required String labRequestId,
    required List<Map<String, dynamic>> results,
  }) async {
    final res = await _api.dio.post<Map<String, dynamic>>(
      '/lab-requests/$labRequestId/results',
      data: {'results': results},
    );
    return LabRequest.fromJson(
        Map<String, dynamic>.from(res.data!['labRequest'] as Map));
  }

  Future<List<LabRequest>> getLabRequestsByEncounter(
      String encounterId) async {
    final res = await _api.dio.get<Map<String, dynamic>>(
      '/lab-requests/by-encounter/$encounterId',
    );
    return (res.data!['labRequests'] as List)
        .map((r) =>
            LabRequest.fromJson(Map<String, dynamic>.from(r as Map)))
        .toList();
  }

  // ── Prescriptions ──────────────────────────────────────────────────────────

  Future<Prescription> createPrescription({
    required String encounterId,
    required List<DrugLine> drugs,
    String? notes,
  }) async {
    final res = await _api.dio.post<Map<String, dynamic>>(
      '/prescriptions',
      data: {
        'encounterId': encounterId,
        'drugs': drugs.map((d) => d.toJson()).toList(),
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
    );
    return Prescription.fromJson(
        Map<String, dynamic>.from(res.data!['prescription'] as Map));
  }

  Future<List<Prescription>> getPrescriptionInbox() async {
    final res =
        await _api.dio.get<Map<String, dynamic>>('/prescriptions/inbox');
    return (res.data!['prescriptions'] as List)
        .map((p) =>
            Prescription.fromJson(Map<String, dynamic>.from(p as Map)))
        .toList();
  }

  Future<List<Prescription>> getPrescriptionsByEncounter(
      String encounterId) async {
    final res = await _api.dio.get<Map<String, dynamic>>(
      '/prescriptions/by-encounter/$encounterId',
    );
    return (res.data!['prescriptions'] as List)
        .map((p) =>
            Prescription.fromJson(Map<String, dynamic>.from(p as Map)))
        .toList();
  }

  // ── Inventory / Dispense ───────────────────────────────────────────────────

  Future<List<StockCheck>> checkStock(String prescriptionId) async {
    final res = await _api.dio.get<Map<String, dynamic>>(
      '/inventory/check/$prescriptionId',
    );
    return (res.data!['checks'] as List)
        .map((c) =>
            StockCheck.fromJson(Map<String, dynamic>.from(c as Map)))
        .toList();
  }

  Future<Prescription> dispense(String prescriptionId) async {
    final res = await _api.dio.post<Map<String, dynamic>>(
      '/inventory/dispense/$prescriptionId',
    );
    return Prescription.fromJson(
        Map<String, dynamic>.from(res.data!['prescription'] as Map));
  }

  // ── Invoices ───────────────────────────────────────────────────────────────

  Future<List<Invoice>> getInvoices({
    String? status,
    String? patientId,
    int page = 1,
  }) async {
    final res = await _api.dio.get<Map<String, dynamic>>(
      '/invoices',
      queryParameters: {
        if (status != null) 'status': status,
        if (patientId != null) 'patientId': patientId,
        'page': page,
      },
    );
    return (res.data!['invoices'] as List)
        .map((i) => Invoice.fromJson(Map<String, dynamic>.from(i as Map)))
        .toList();
  }

  Future<List<Invoice>> getMyInvoices(String patientId) async {
    final res = await _api.dio.get<Map<String, dynamic>>(
      '/invoices/my',
      queryParameters: {'patientId': patientId},
    );
    return (res.data!['invoices'] as List)
        .map((i) => Invoice.fromJson(Map<String, dynamic>.from(i as Map)))
        .toList();
  }

  Future<Invoice> getInvoice(String id) async {
    final res =
        await _api.dio.get<Map<String, dynamic>>('/invoices/$id');
    return Invoice.fromJson(
        Map<String, dynamic>.from(res.data!['invoice'] as Map));
  }

  Future<Invoice> adjustInvoice({
    required String invoiceId,
    required int deltaKobo,
    required String reason,
  }) async {
    final res = await _api.dio.patch<Map<String, dynamic>>(
      '/invoices/$invoiceId/adjust',
      data: {'deltaKobo': deltaKobo, 'reason': reason},
    );
    return Invoice.fromJson(
        Map<String, dynamic>.from(res.data!['invoice'] as Map));
  }

  Future<Invoice> cancelInvoice(String invoiceId) async {
    final res = await _api.dio.post<Map<String, dynamic>>(
      '/invoices/$invoiceId/cancel',
    );
    return Invoice.fromJson(
        Map<String, dynamic>.from(res.data!['invoice'] as Map));
  }

  // ── Payments ───────────────────────────────────────────────────────────────

  Future<Map<String, String>> initializePayment({
    required String invoiceId,
    required String email,
  }) async {
    final res = await _api.dio.post<Map<String, dynamic>>(
      '/payments/initialize',
      data: {'invoiceId': invoiceId, 'email': email},
    );
    return {
      'authorizationUrl': res.data!['authorizationUrl']?.toString() ?? '',
      'reference': res.data!['reference']?.toString() ?? '',
    };
  }

  Future<Invoice> getPaymentStatus(String invoiceId) async {
    final res = await _api.dio
        .get<Map<String, dynamic>>('/payments/status/$invoiceId');
    return Invoice.fromJson(
        Map<String, dynamic>.from(res.data!['invoice'] as Map));
  }
}
