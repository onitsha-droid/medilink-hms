import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/auth_models.dart';
import '../providers/auth_provider.dart';
import '../../features/auth/auth.dart';
import '../../features/doctor/doctor_dashboard.dart';
import '../../features/lab_scientist/lab_worklist_screen.dart';
import '../../features/pharmacist/pharmacist_inbox_screen.dart';
import '../../features/billing_officer/billing_dashboard.dart';
import '../../features/nurse/nurse_triage_screen.dart';

// ── Route names ───────────────────────────────────────────────────────────────
abstract class Routes {
  static const splash = '/';
  static const login = '/login';

  // Role dashboards
  static const patientHome = '/patient';
  static const frontDeskHome = '/front-desk';
  static const nurseHome = '/nurse';
  static const doctorHome = '/doctor';
  static const labHome = '/lab';
  static const pharmacistHome = '/pharmacist';
  static const billingHome = '/billing';
  static const adminHome = '/admin';
}

// ── Router provider ───────────────────────────────────────────────────────────

final routerProvider = Provider<GoRouter>((ref) {
  final authNotifier = ref.watch(authProvider.notifier);

  return GoRouter(
    initialLocation: Routes.splash,
    refreshListenable: _AuthStateListenable(ref),
    redirect: (context, state) {
      final authState = ref.read(authProvider);
      final location = state.matchedLocation;

      // Still loading — hold at splash
      if (authState is AuthStateLoading) {
        return location == Routes.splash ? null : Routes.splash;
      }

      // Not authenticated — send to login
      if (authState is AuthStateUnauthenticated) {
        return location == Routes.login ? null : Routes.login;
      }

      // Authenticated
      if (authState is AuthStateAuthenticated) {
        // Don't keep them on splash or login
        if (location == Routes.splash || location == Routes.login) {
          return _dashboardForRole(authState.user.role);
        }
        // Enforce role — redirect if they hit a dashboard not theirs
        final expected = _dashboardForRole(authState.user.role);
        if (_isDashboardRoute(location) && location != expected) {
          return expected;
        }
      }

      return null;
    },
    routes: [
      GoRoute(
        path: Routes.splash,
        builder: (_, __) => const _SplashScreen(),
      ),
      GoRoute(
        path: Routes.login,
        builder: (_, __) => const _LoginScreenShell(),
      ),
      GoRoute(
        path: Routes.patientHome,
        builder: (_, __) => const _RoleDashboard(role: UserRole.patient),
      ),
      GoRoute(
        path: Routes.frontDeskHome,
        builder: (_, __) => const _RoleDashboard(role: UserRole.frontDesk),
      ),
      GoRoute(
        path: Routes.nurseHome,
        builder: (_, __) => const _RoleDashboard(role: UserRole.nurse),
      ),
      GoRoute(
        path: Routes.doctorHome,
        builder: (_, __) => const DoctorDashboard(),
      ),
      GoRoute(
        path: Routes.labHome,
        builder: (_, __) => const LabWorklistScreen(),
      ),
      GoRoute(
        path: Routes.pharmacistHome,
        builder: (_, __) => const PharmacistInboxScreen(),
      ),
      GoRoute(
        path: Routes.billingHome,
        builder: (_, __) => const BillingDashboard(),
      ),
      GoRoute(
        path: Routes.adminHome,
        builder: (_, __) => const _RoleDashboard(role: UserRole.admin),
      ),
    ],
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

String _dashboardForRole(UserRole role) {
  switch (role) {
    case UserRole.patient:
      return Routes.patientHome;
    case UserRole.frontDesk:
      return Routes.frontDeskHome;
    case UserRole.nurse:
      return Routes.nurseHome;
    case UserRole.doctor:
      return Routes.doctorHome;
    case UserRole.labScientist:
      return Routes.labHome;
    case UserRole.pharmacist:
      return Routes.pharmacistHome;
    case UserRole.billingOfficer:
      return Routes.billingHome;
    case UserRole.admin:
      return Routes.adminHome;
  }
}

const _dashboardRoutes = {
  Routes.patientHome,
  Routes.frontDeskHome,
  Routes.nurseHome,
  Routes.doctorHome,
  Routes.labHome,
  Routes.pharmacistHome,
  Routes.billingHome,
  Routes.adminHome,
};

bool _isDashboardRoute(String location) => _dashboardRoutes.contains(location);

// ── Listenable bridge for GoRouter.refreshListenable ─────────────────────────

class _AuthStateListenable extends ChangeNotifier {
  _AuthStateListenable(Ref ref) {
    ref.listen<AuthState>(authProvider, (_, __) => notifyListeners());
  }
}

// ── Placeholder screens ───────────────────────────────────────────────────────

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator()),
    );
  }
}

/// Shell that wires up the real LoginScreen (defined in the auth feature).
class _LoginScreenShell extends StatelessWidget {
  const _LoginScreenShell();

  @override
  Widget build(BuildContext context) {
    return const LoginScreen();
  }
}

/// Generic placeholder dashboard — replaced by each role's real screen
/// in later commits.
class _RoleDashboard extends ConsumerWidget {
  const _RoleDashboard({required this.role});
  final UserRole role;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${role.label} Dashboard'),
        actions: [
          IconButton(
            key: Key('logout_button_${role.name}'),
            icon: const Icon(Icons.logout),
            tooltip: 'Log out',
            onPressed: () => ref.read(authProvider.notifier).logout(),
          ),
        ],
      ),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.dashboard, size: 64, color: Colors.blueGrey),
            const SizedBox(height: 16),
            Text(
              role.label,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            const Text('Feature screens coming soon.'),
          ],
        ),
      ),
    );
  }
}
