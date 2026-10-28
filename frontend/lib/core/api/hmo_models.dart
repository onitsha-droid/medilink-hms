// ── HMO/NHIA claim domain models ─────────────────────────────────────────────

class HmoClaim {
  const HmoClaim({
    required this.id,
    required this.invoiceId,
    required this.policyId,
    required this.serviceCode,
    required this.requestedAmountKobo,
    required this.status,
    this.payoutAmountKobo = 0,
    this.reasonCode = 0,
    this.reasonText,
    this.stellarTxHash,
    this.submittedByName,
    this.createdAt,
  });

  final String id;
  final String invoiceId;
  final String policyId;
  final int serviceCode;
  final int requestedAmountKobo;
  final String status; // pending | approved | partially_paid | rejected | manual_review
  final int payoutAmountKobo;
  final int reasonCode;
  final String? reasonText;
  final String? stellarTxHash;
  final String? submittedByName;
  final DateTime? createdAt;

  double get requestedNaira => requestedAmountKobo / 100.0;
  double get payoutNaira => payoutAmountKobo / 100.0;

  bool get isApproved => status == 'approved' || status == 'partially_paid';
  bool get isRejected => status == 'rejected';
  bool get needsReview => status == 'manual_review';

  factory HmoClaim.fromJson(Map<String, dynamic> json) {
    final submitter = json['submittedBy'];
    final invoice = json['invoice'];
    return HmoClaim(
      id: (json['_id'] ?? '').toString(),
      invoiceId: invoice is Map
          ? (invoice['_id'] ?? '').toString()
          : (json['invoice'] ?? '').toString(),
      policyId: (json['policyId'] ?? '').toString(),
      serviceCode: (json['serviceCode'] as num?)?.toInt() ?? 0,
      requestedAmountKobo: (json['requestedAmountKobo'] as num?)?.toInt() ?? 0,
      status: (json['status'] ?? 'pending').toString(),
      payoutAmountKobo: (json['payoutAmountKobo'] as num?)?.toInt() ?? 0,
      reasonCode: (json['reasonCode'] as num?)?.toInt() ?? 0,
      reasonText: json['reasonText']?.toString(),
      stellarTxHash: json['stellarTxHash']?.toString(),
      submittedByName: submitter is Map ? submitter['name']?.toString() : null,
      createdAt: json['createdAt'] != null
          ? DateTime.tryParse(json['createdAt'].toString())
          : null,
    );
  }
}

class AdminDashboard {
  const AdminDashboard({
    required this.patientsToday,
    required this.queue,
    required this.revenueFiatKobo,
    required this.revenueStablecoinKobo,
    required this.lowStock,
    required this.claims,
  });

  final int patientsToday;
  final List<ClinicQueueMetric> queue;
  final int revenueFiatKobo;
  final int revenueStablecoinKobo;
  final List<Map<String, dynamic>> lowStock;
  final Map<String, dynamic> claims;

  double get revenueFiatNaira => revenueFiatKobo / 100.0;
  double get revenueStablecoinNaira => revenueStablecoinKobo / 100.0;

  factory AdminDashboard.fromJson(Map<String, dynamic> json) {
    final revenue = json['revenue'] as Map<String, dynamic>? ?? {};
    final fiat = revenue['fiat'] as Map<String, dynamic>? ?? {};
    final stable = revenue['stablecoin'] as Map<String, dynamic>? ?? {};
    return AdminDashboard(
      patientsToday: (json['patientsToday'] as num?)?.toInt() ?? 0,
      queue: (json['queue'] as List<dynamic>? ?? [])
          .map((q) => ClinicQueueMetric.fromJson(Map<String, dynamic>.from(q as Map)))
          .toList(),
      revenueFiatKobo: (fiat['totalKobo'] as num?)?.toInt() ?? 0,
      revenueStablecoinKobo: (stable['totalKobo'] as num?)?.toInt() ?? 0,
      lowStock: (json['lowStock'] as List<dynamic>? ?? [])
          .map((i) => Map<String, dynamic>.from(i as Map))
          .toList(),
      claims: json['claims'] as Map<String, dynamic>? ?? {},
    );
  }
}

class ClinicQueueMetric {
  const ClinicQueueMetric({
    required this.clinicId,
    required this.clinicName,
    required this.queueLength,
    required this.urgent,
    required this.estimatedWaitMinutes,
  });

  final String clinicId;
  final String clinicName;
  final int queueLength;
  final int urgent;
  final int estimatedWaitMinutes;

  factory ClinicQueueMetric.fromJson(Map<String, dynamic> json) =>
      ClinicQueueMetric(
        clinicId: (json['clinicId'] ?? '').toString(),
        clinicName: (json['clinicName'] ?? 'Unknown').toString(),
        queueLength: (json['queueLength'] as num?)?.toInt() ?? 0,
        urgent: (json['urgent'] as num?)?.toInt() ?? 0,
        estimatedWaitMinutes:
            (json['estimatedWaitMinutes'] as num?)?.toInt() ?? 0,
      );
}
