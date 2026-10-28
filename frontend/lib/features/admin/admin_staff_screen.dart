import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/clinical_repository.dart';
import '../../core/providers/auth_provider.dart';

// ── Providers ─────────────────────────────────────────────────────────────────

final staffListProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) =>
        ref.read(clinicalRepositoryProvider).listUsers());

final clinicListProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final res = await ref.read(clinicalRepositoryProvider).listClinics();
  return res;
});

// ── Admin Staff Management Screen ─────────────────────────────────────────────

class AdminStaffScreen extends ConsumerWidget {
  const AdminStaffScreen({super.key});

  static const _roles = [
    'Patient', 'Front Desk', 'Nurse', 'Doctor',
    'Lab Scientist', 'Pharmacist', 'Billing Officer', 'Admin',
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final staffAsync = ref.watch(staffListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Staff & Roles'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(staffListProvider),
          ),
        ],
      ),
      body: staffAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (users) {
          // Filter out patients — this screen is for staff only
          final staff = users.where((u) => u['role'] != 'Patient').toList();
          if (staff.isEmpty) {
            return const Center(child: Text('No staff members found.'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: staff.length,
            separatorBuilder: (_, __) => const SizedBox(height: 6),
            itemBuilder: (context, i) {
              final user = staff[i];
              return Card(
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: Colors.blue.shade50,
                    child: Text(
                      (user['name'] as String? ?? '?')[0].toUpperCase(),
                      style: TextStyle(
                          color: Colors.blue.shade700,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
                  title: Text(user['name'] as String? ?? '—',
                      style:
                          const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text(
                      '${user['email']} · ${user['role']}',
                      style: const TextStyle(fontSize: 12)),
                  trailing: PopupMenuButton<String>(
                    tooltip: 'Change role',
                    icon: const Icon(Icons.more_vert),
                    onSelected: (newRole) async {
                      try {
                        await ref
                            .read(clinicalRepositoryProvider)
                            .changeUserRole(
                              userId: user['_id'].toString(),
                              role: newRole,
                            );
                        ref.invalidate(staffListProvider);
                      } catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                                content: Text('Error: $e'),
                                backgroundColor: Colors.red),
                          );
                        }
                      }
                    },
                    itemBuilder: (_) => _roles
                        .where((r) => r != user['role'])
                        .map((r) => PopupMenuItem(
                              value: r,
                              child: Text(r),
                            ))
                        .toList(),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

// ── Admin Clinic Config Screen ─────────────────────────────────────────────────

class AdminClinicsScreen extends ConsumerWidget {
  const AdminClinicsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final clinicsAsync = ref.watch(clinicListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Clinic Configuration'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(clinicListProvider),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showClinicDialog(context, ref, null),
        tooltip: 'Add clinic',
        child: const Icon(Icons.add),
      ),
      body: clinicsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (clinics) {
          if (clinics.isEmpty) {
            return const Center(child: Text('No clinics configured.'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: clinics.length,
            separatorBuilder: (_, __) => const SizedBox(height: 6),
            itemBuilder: (context, i) {
              final clinic = clinics[i];
              final isActive = clinic['isActive'] as bool? ?? true;
              return Card(
                child: ListTile(
                  leading: Icon(
                    Icons.local_hospital,
                    color: isActive ? Colors.blue : Colors.grey,
                  ),
                  title: Text(clinic['name'] as String? ?? '—',
                      style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: isActive ? null : Colors.grey)),
                  subtitle: Text(
                    'Avg ${clinic['avgConsultationMinutes'] ?? 15} min/consult'
                    '${isActive ? '' : ' · INACTIVE'}',
                    style: const TextStyle(fontSize: 12),
                  ),
                  trailing: IconButton(
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () =>
                        _showClinicDialog(context, ref, clinic),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }

  void _showClinicDialog(
      BuildContext context, WidgetRef ref, Map<String, dynamic>? clinic) {
    final nameCtrl = TextEditingController(
        text: clinic?['name']?.toString() ?? '');
    final descCtrl = TextEditingController(
        text: clinic?['description']?.toString() ?? '');
    final avgCtrl = TextEditingController(
        text: (clinic?['avgConsultationMinutes'] ?? 15).toString());
    final isEditing = clinic != null;

    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(isEditing ? 'Edit Clinic' : 'Add Clinic'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: nameCtrl,
              decoration: const InputDecoration(
                  labelText: 'Name *', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: descCtrl,
              decoration: const InputDecoration(
                  labelText: 'Description',
                  border: OutlineInputBorder()),
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: avgCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                  labelText: 'Avg consultation (min)',
                  border: OutlineInputBorder()),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('CANCEL'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.of(ctx).pop();
              try {
                if (isEditing) {
                  await ref
                      .read(clinicalRepositoryProvider)
                      .updateClinic(
                        clinicId: clinic['_id'].toString(),
                        name: nameCtrl.text.trim(),
                        description: descCtrl.text.trim(),
                        avgConsultationMinutes:
                            int.tryParse(avgCtrl.text) ?? 15,
                      );
                } else {
                  await ref
                      .read(clinicalRepositoryProvider)
                      .createClinic(
                        name: nameCtrl.text.trim(),
                        description: descCtrl.text.trim(),
                        avgConsultationMinutes:
                            int.tryParse(avgCtrl.text) ?? 15,
                      );
                }
                ref.invalidate(clinicListProvider);
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                        content: Text('Error: $e'),
                        backgroundColor: Colors.red),
                  );
                }
              }
            },
            child: Text(isEditing ? 'SAVE' : 'CREATE'),
          ),
        ],
      ),
    );
  }
}
