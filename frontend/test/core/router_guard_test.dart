import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:medilink_hms/core/api/api_client.dart';
import 'package:medilink_hms/core/api/auth_models.dart';
import 'package:medilink_hms/core/providers/auth_provider.dart';
import 'package:medilink_hms/core/router/app_router.dart';

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Builds a testable app with the router under a ProviderScope that
/// overrides [authProvider] with [overrideState].
Widget buildTestApp(AuthState overrideState) {
  return ProviderScope(
    overrides: [
      authProvider.overrideWith(
        (ref) => _FakeAuthNotifier(overrideState),
      ),
    ],
    child: Consumer(
      builder: (context, ref, _) {
        final router = ref.watch(routerProvider);
        return MaterialApp.router(routerConfig: router);
      },
    ),
  );
}

class _FakeAuthNotifier extends AuthNotifier {
  _FakeAuthNotifier(AuthState initial) : super(ApiClient(), initial);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

void main() {
  group('Route guard — unauthenticated', () {
    testWidgets('shows login screen when unauthenticated', (tester) async {
      await tester.pumpWidget(
        buildTestApp(const AuthStateUnauthenticated()),
      );
      await tester.pumpAndSettle();

      // The login form key field should be present
      expect(find.byKey(const Key('email_field')), findsOneWidget);
      expect(find.byKey(const Key('password_field')), findsOneWidget);
    });
  });

  group('Route guard — loading', () {
    testWidgets('shows splash spinner while loading', (tester) async {
      await tester.pumpWidget(
        buildTestApp(const AuthStateLoading()),
      );
      await tester.pump(); // don't settle — loading state is intentionally active

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });
  });

  group('Route guard — authenticated role routing', () {
    final roleCases = [
      (UserRole.patient, Routes.patientHome, 'Patient', 'Patient Dashboard'),
      (UserRole.frontDesk, Routes.frontDeskHome, 'Front Desk', 'Front Desk Dashboard'),
      (UserRole.nurse, Routes.nurseHome, 'Nurse', 'Nurse Dashboard'),
      (UserRole.doctor, Routes.doctorHome, 'Doctor', 'My Queue'),
      (UserRole.labScientist, Routes.labHome, 'Lab Scientist', 'Lab Worklist'),
      (UserRole.pharmacist, Routes.pharmacistHome, 'Pharmacist', 'Prescription Inbox'),
      (UserRole.billingOfficer, Routes.billingHome, 'Billing Officer', 'Billing Dashboard'),
      (UserRole.admin, Routes.adminHome, 'Admin', 'Admin Dashboard'),
    ];

    for (final (role, _, label, expectedTitle) in roleCases) {
      testWidgets('role $label lands on its own dashboard', (tester) async {
        final user = AuthUser(
          id: 'u1',
          name: label,
          email: '${role.name}@test.com',
          role: role,
        );

        await tester.pumpWidget(
          buildTestApp(
            AuthStateAuthenticated(user: user, token: 'tok'),
          ),
        );
        await tester.pumpAndSettle();

        // The dashboard app-bar title contains the expected label
        expect(find.text(expectedTitle), findsOneWidget);
      });
    }
  });

  group('Route guard — cross-role access denied', () {
    testWidgets(
        'Patient authenticated but navigating to /admin is redirected to Patient dashboard',
        (tester) async {
      final user = AuthUser(
        id: 'u1',
        name: 'P',
        email: 'p@test.com',
        role: UserRole.patient,
      );

      late GoRouter router;

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith(
              (ref) => _FakeAuthNotifier(
                AuthStateAuthenticated(user: user, token: 'tok'),
              ),
            ),
          ],
          child: Consumer(builder: (context, ref, _) {
            router = ref.watch(routerProvider);
            return MaterialApp.router(routerConfig: router);
          }),
        ),
      );
      await tester.pumpAndSettle();

      // Manually try to navigate to admin
      router.go(Routes.adminHome);
      await tester.pumpAndSettle();

      // Should be redirected back to patient dashboard
      expect(find.text('Patient Dashboard'), findsOneWidget);
      expect(find.text('Admin Dashboard'), findsNothing);
    });
  });

  group('Login screen UI', () {
    testWidgets('shows error banner on unauthenticated state with error',
        (tester) async {
      await tester.pumpWidget(
        buildTestApp(
          const AuthStateUnauthenticated(error: 'Invalid credentials'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('error_banner')), findsOneWidget);
      expect(find.text('Invalid credentials'), findsOneWidget);
    });

    testWidgets('login button is present and labelled', (tester) async {
      await tester.pumpWidget(
        buildTestApp(const AuthStateUnauthenticated()),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('login_button')), findsOneWidget);
    });
  });
}
