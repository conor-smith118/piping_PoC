import { createBrowserRouter, RouterProvider, NavLink, Outlet } from 'react-router';
import { useEffect, useState } from 'react';
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useIsMobile,
} from '@databricks/appkit-ui/react';
import { Menu } from 'lucide-react';
import { ProjectPicker } from './pages/ProjectPicker';
import { ProjectView } from './pages/ProjectView';
import { Admin } from './pages/Admin';
import { api } from './lib/api';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

type NavLinkClassFn = (props: { isActive: boolean }) => string;

function NavLinks({
  className,
  linkClass,
  onClick,
  showAdmin,
}: {
  className?: string;
  linkClass: NavLinkClassFn;
  onClick?: () => void;
  showAdmin: boolean;
}) {
  return (
    <nav className={className}>
      <NavLink to="/" end className={linkClass} onClick={onClick}>
        Projects
      </NavLink>
      {showAdmin && (
        <NavLink to="/admin" className={linkClass} onClick={onClick}>
          Admin
        </NavLink>
      )}
    </nav>
  );
}

function Layout() {
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // Derived, not synced via effect: the sheet is only ever meaningfully open
  // on mobile viewports anyway (its trigger lives in a `md:hidden` wrapper).
  const showMobileSheet = isMobile && mobileNavOpen;

  useEffect(() => {
    // Same "fetch /api/me, check eligibleRoles" pattern used per-page in
    // ProjectPicker/ProjectView/Admin — just gates whether the nav link
    // renders at all. The route itself (Admin.tsx) still 403s/gates
    // server-side regardless, so this is UX polish, not the security check.
    api
      .me()
      .then((m) => setIsAdmin(m.eligibleRoles.includes('Admin')))
      .catch(() => setIsAdmin(false));
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-4 md:px-6 py-3 flex items-center gap-4">
        <h1 className="text-lg font-semibold text-foreground">Burns &amp; McDonnell Piping PoC</h1>
        {/* Desktop nav — hidden below md breakpoint */}
        <NavLinks className="hidden md:flex gap-1" linkClass={navLinkClass} showAdmin={isAdmin} />
        {/* Mobile nav — visible below md breakpoint */}
        <div className="ml-auto md:hidden">
          <Sheet open={showMobileSheet} onOpenChange={setMobileNavOpen}>
            <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)}>
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open navigation</span>
            </Button>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <NavLinks
                className="flex flex-col gap-1"
                linkClass={mobileNavLinkClass}
                onClick={() => setMobileNavOpen(false)}
                showAdmin={isAdmin}
              />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <ProjectPicker /> },
      { path: '/projects/:projectId', element: <ProjectView /> },
      { path: '/admin', element: <Admin /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
