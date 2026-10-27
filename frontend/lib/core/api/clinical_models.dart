// ── Clinical domain models (hand-written, no codegen needed) ─────────────────

class Encounter {
  const Encounter({
    required this.id,
    required this.patientId,
    required this.doctorId,
    required this.clinicId,
    required this.status,
    this.chiefComplaint,
    this.primaryDiagnosis,
    this.createdAt,
    this.completedAt,
    this.patientName,
    this.doctorName,
    this.clinicName,
  });

  final String id;
  final String patientId;
  final String doctorId;
  final String clinicId;
  final String status;
  final String? chiefComplaint;
  final DiagnosisEntry? primaryDiagnosis;
  final DateTime? createdAt;
  final DateTime? completedAt;
  final String? patientName;
  final String? doctorName;
  final String? clinicName;

  factory Encounter.fromJson(Map<String, dynamic> json) {
    final patient = json['patient'];
    final doctor = json['doctor'];
    final clinic = json['clinic'];

    final patientId =
        patient is Map ? (patient['_id'] ?? '').toString() : (patient ?? '').toString();
    final patientName = patient is Map
        ? '${patient['firstName'] ?? ''} ${patient['lastName'] ?? ''}'.trim()
        : null;

    final doctorId =
        doctor is Map ? (doctor['_id'] ?? '').toString() : (doctor ?? '').toString();
    final doctorName = doctor is Map ? doctor['name']?.toString() : null;

    final clinicId =
        clinic is Map ? (clinic['_id'] ?? '').toString() : (clinic ?? '').toString();
    final clinicName = clinic is Map ? clinic['name']?.toString() : null;

    return Encounter(
      id: (json['_id'] ?? '').toString(),
      patientId: patientId,
      doctorId: doctorId,
      clinicId: clinicId,
      status: (json['status'] ?? 'open').toString(),
      chiefComplaint: json['chiefComplaint']?.toString(),
      primaryDiagnosis: json['primaryDiagnosis'] is Map
          ? DiagnosisEntry.fromJson(
              Map<String, dynamic>.from(json['primaryDiagnosis'] as Map))
          : null,
      createdAt: _parseDate(json['createdAt']),
      completedAt: _parseDate(json['completedAt']),
      patientName: patientName,
      doctorName: doctorName,
      clinicName: clinicName,
    );
  }
}

class DiagnosisEntry {
  const DiagnosisEntry({this.code, this.description});
  final String? code;
  final String? description;

  factory DiagnosisEntry.fromJson(Map<String, dynamic> json) => DiagnosisEntry(
        code: json['code']?.toString(),
        description: json['description']?.toString(),
      );

  Map<String, dynamic> toJson() => {
        if (code != null && code!.isNotEmpty) 'code': code,
        if (description != null && description!.isNotEmpty) 'description': description,
      };
}

class ClinicalNote {
  const ClinicalNote({
    required this.id,
    required this.encounterId,
    required this.patientId,
    required this.authorName,
    this.subjective,
    this.objective,
    this.assessment,
    this.plan,
    this.diagnosis,
    this.createdAt,
  });

  final String id;
  final String encounterId;
  final String patientId;
  final String authorName;
  final String? subjective;
  final String? objective;
  final String? assessment;
  final String? plan;
  final DiagnosisEntry? diagnosis;
  final DateTime? createdAt;

  factory ClinicalNote.fromJson(Map<String, dynamic> json) {
    final author = json['author'];
    return ClinicalNote(
      id: (json['_id'] ?? '').toString(),
      encounterId: (json['encounter'] ?? '').toString(),
      patientId: (json['patient'] ?? '').toString(),
      authorName: author is Map ? (author['name'] ?? '').toString() : '',
      subjective: json['subjective']?.toString(),
      objective: json['objective']?.toString(),
      assessment: json['assessment']?.toString(),
      plan: json['plan']?.toString(),
      diagnosis: json['diagnosis'] is Map
          ? DiagnosisEntry.fromJson(
              Map<String, dynamic>.from(json['diagnosis'] as Map))
          : null,
      createdAt: _parseDate(json['createdAt']),
    );
  }
}

class VitalsRecord {
  const VitalsRecord({
    required this.id,
    this.bpSystolic,
    this.bpDiastolic,
    this.spo2,
    this.weightKg,
    this.temperatureCelsius,
    this.heartRateBpm,
    this.isUrgent = false,
    this.urgentReason,
    this.recordedByName,
    this.createdAt,
  });

  final String id;
  final double? bpSystolic;
  final double? bpDiastolic;
  final double? spo2;
  final double? weightKg;
  final double? temperatureCelsius;
  final double? heartRateBpm;
  final bool isUrgent;
  final String? urgentReason;
  final String? recordedByName;
  final DateTime? createdAt;

  factory VitalsRecord.fromJson(Map<String, dynamic> json) {
    final recorder = json['recordedBy'];
    return VitalsRecord(
      id: (json['_id'] ?? '').toString(),
      bpSystolic: (json['bpSystolic'] as num?)?.toDouble(),
      bpDiastolic: (json['bpDiastolic'] as num?)?.toDouble(),
      spo2: (json['spo2'] as num?)?.toDouble(),
      weightKg: (json['weightKg'] as num?)?.toDouble(),
      temperatureCelsius: (json['temperatureCelsius'] as num?)?.toDouble(),
      heartRateBpm: (json['heartRateBpm'] as num?)?.toDouble(),
      isUrgent: json['isUrgent'] as bool? ?? false,
      urgentReason: json['urgentReason']?.toString(),
      recordedByName:
          recorder is Map ? recorder['name']?.toString() : null,
      createdAt: _parseDate(json['createdAt']),
    );
  }
}

class LabResult {
  const LabResult({
    required this.testName,
    required this.value,
    this.unit,
    this.referenceRange,
    this.isAbnormal = false,
    this.abnormalFlag,
    this.notes,
  });

  final String testName;
  final String value;
  final String? unit;
  final String? referenceRange;
  final bool isAbnormal;
  final String? abnormalFlag;
  final String? notes;

  factory LabResult.fromJson(Map<String, dynamic> json) => LabResult(
        testName: (json['testName'] ?? '').toString(),
        value: (json['value'] ?? '').toString(),
        unit: json['unit']?.toString(),
        referenceRange: json['referenceRange']?.toString(),
        isAbnormal: json['isAbnormal'] as bool? ?? false,
        abnormalFlag: json['abnormalFlag']?.toString(),
        notes: json['notes']?.toString(),
      );
}

class LabRequest {
  const LabRequest({
    required this.id,
    required this.encounterId,
    required this.patientId,
    required this.status,
    required this.tests,
    this.results = const [],
    this.urgency = 'routine',
    this.requestedByName,
    this.createdAt,
    this.completedAt,
    this.patientName,
    this.patientHospitalId,
  });

  final String id;
  final String encounterId;
  final String patientId;
  final String status;
  final List<Map<String, dynamic>> tests;
  final List<LabResult> results;
  final String urgency;
  final String? requestedByName;
  final DateTime? createdAt;
  final DateTime? completedAt;
  final String? patientName;
  final String? patientHospitalId;

  factory LabRequest.fromJson(Map<String, dynamic> json) {
    final requester = json['requestedBy'];
    final patient = json['patient'];
    return LabRequest(
      id: (json['_id'] ?? '').toString(),
      encounterId: (json['encounter'] ?? '').toString(),
      patientId: patient is Map
          ? (patient['_id'] ?? '').toString()
          : (patient ?? '').toString(),
      status: (json['status'] ?? 'requested').toString(),
      tests: (json['tests'] as List<dynamic>? ?? [])
          .map((t) => Map<String, dynamic>.from(t as Map))
          .toList(),
      results: (json['results'] as List<dynamic>? ?? [])
          .map((r) => LabResult.fromJson(
              Map<String, dynamic>.from(r as Map)))
          .toList(),
      urgency: (json['urgency'] ?? 'routine').toString(),
      requestedByName:
          requester is Map ? requester['name']?.toString() : null,
      createdAt: _parseDate(json['createdAt']),
      completedAt: _parseDate(json['completedAt']),
      patientName: patient is Map
          ? '${patient['firstName'] ?? ''} ${patient['lastName'] ?? ''}'.trim()
          : null,
      patientHospitalId:
          patient is Map ? patient['hospitalId']?.toString() : null,
    );
  }
}

class DrugLine {
  const DrugLine({
    required this.drugName,
    required this.dose,
    required this.frequency,
    required this.duration,
    required this.quantity,
    this.instructions,
    this.unitPriceKobo = 0,
  });

  final String drugName;
  final String dose;
  final String frequency;
  final String duration;
  final int quantity;
  final String? instructions;
  final int unitPriceKobo;

  Map<String, dynamic> toJson() => {
        'drugName': drugName,
        'dose': dose,
        'frequency': frequency,
        'duration': duration,
        'quantity': quantity,
        if (instructions != null && instructions!.isNotEmpty)
          'instructions': instructions,
        'unitPriceKobo': unitPriceKobo,
      };

  factory DrugLine.fromJson(Map<String, dynamic> json) => DrugLine(
        drugName: (json['drugName'] ?? '').toString(),
        dose: (json['dose'] ?? '').toString(),
        frequency: (json['frequency'] ?? '').toString(),
        duration: (json['duration'] ?? '').toString(),
        quantity: (json['quantity'] as num?)?.toInt() ?? 1,
        instructions: json['instructions']?.toString(),
        unitPriceKobo: (json['unitPriceKobo'] as num?)?.toInt() ?? 0,
      );
}

class Prescription {
  const Prescription({
    required this.id,
    required this.encounterId,
    required this.patientId,
    required this.status,
    required this.drugs,
    this.prescribedByName,
    this.notes,
    this.createdAt,
    this.patientName,
    this.invoiceId,
  });

  final String id;
  final String encounterId;
  final String patientId;
  final String status;
  final List<DrugLine> drugs;
  final String? prescribedByName;
  final String? notes;
  final DateTime? createdAt;
  final String? patientName;
  final String? invoiceId;

  factory Prescription.fromJson(Map<String, dynamic> json) {
    final prescriber = json['prescribedBy'];
    final patient = json['patient'];
    return Prescription(
      id: (json['_id'] ?? '').toString(),
      encounterId: (json['encounter'] ?? '').toString(),
      patientId: patient is Map
          ? (patient['_id'] ?? '').toString()
          : (patient ?? '').toString(),
      status: (json['status'] ?? 'sent').toString(),
      drugs: (json['drugs'] as List<dynamic>? ?? [])
          .map((d) => DrugLine.fromJson(
              Map<String, dynamic>.from(d as Map)))
          .toList(),
      prescribedByName:
          prescriber is Map ? prescriber['name']?.toString() : null,
      notes: json['notes']?.toString(),
      createdAt: _parseDate(json['createdAt']),
      patientName: patient is Map
          ? '${patient['firstName'] ?? ''} ${patient['lastName'] ?? ''}'.trim()
          : null,
      invoiceId: json['invoice']?.toString(),
    );
  }
}

class StockCheck {
  const StockCheck({
    required this.drugName,
    required this.dose,
    required this.quantityRequired,
    this.quantityOnHand,
    required this.inStock,
    this.isLowStock,
  });

  final String drugName;
  final String dose;
  final int quantityRequired;
  final int? quantityOnHand;
  final bool inStock;
  final bool? isLowStock;

  factory StockCheck.fromJson(Map<String, dynamic> json) => StockCheck(
        drugName: (json['drugName'] ?? '').toString(),
        dose: (json['dose'] ?? '').toString(),
        quantityRequired: (json['quantityRequired'] as num?)?.toInt() ?? 0,
        quantityOnHand: (json['quantityOnHand'] as num?)?.toInt(),
        inStock: json['inStock'] as bool? ?? false,
        isLowStock: json['isLowStock'] as bool?,
      );
}

class InvoiceLineItem {
  const InvoiceLineItem({
    required this.description,
    required this.amountKobo,
    this.itemType = 'other',
  });

  final String description;
  final int amountKobo;
  final String itemType;

  double get amountNaira => amountKobo / 100.0;

  factory InvoiceLineItem.fromJson(Map<String, dynamic> json) =>
      InvoiceLineItem(
        description: (json['description'] ?? '').toString(),
        amountKobo: (json['amountKobo'] as num?)?.toInt() ?? 0,
        itemType: (json['itemType'] ?? 'other').toString(),
      );
}

class Invoice {
  const Invoice({
    required this.id,
    required this.patientId,
    required this.status,
    required this.totalKobo,
    required this.lineItems,
    this.encounterId,
    this.receiptNumber,
    this.paidAt,
    this.createdAt,
    this.paystackReference,
    this.patientName,
    this.patientHospitalId,
  });

  final String id;
  final String patientId;
  final String status;
  final int totalKobo;
  final List<InvoiceLineItem> lineItems;
  final String? encounterId;
  final String? receiptNumber;
  final DateTime? paidAt;
  final DateTime? createdAt;
  final String? paystackReference;
  final String? patientName;
  final String? patientHospitalId;

  double get totalNaira => totalKobo / 100.0;

  factory Invoice.fromJson(Map<String, dynamic> json) {
    final patient = json['patient'];
    return Invoice(
      id: (json['_id'] ?? '').toString(),
      patientId: patient is Map
          ? (patient['_id'] ?? '').toString()
          : (patient ?? '').toString(),
      status: (json['status'] ?? 'pending').toString(),
      totalKobo: (json['totalKobo'] as num?)?.toInt() ?? 0,
      lineItems: (json['lineItems'] as List<dynamic>? ?? [])
          .map((i) => InvoiceLineItem.fromJson(
              Map<String, dynamic>.from(i as Map)))
          .toList(),
      encounterId: json['encounter']?.toString(),
      receiptNumber: json['receiptNumber']?.toString(),
      paidAt: _parseDate(json['paidAt']),
      createdAt: _parseDate(json['createdAt']),
      paystackReference: json['paystackReference']?.toString(),
      patientName: patient is Map
          ? '${patient['firstName'] ?? ''} ${patient['lastName'] ?? ''}'.trim()
          : null,
      patientHospitalId:
          patient is Map ? patient['hospitalId']?.toString() : null,
    );
  }
}

DateTime? _parseDate(dynamic value) {
  if (value == null) return null;
  return DateTime.tryParse(value.toString());
}
