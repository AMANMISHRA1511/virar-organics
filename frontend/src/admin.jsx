import React, { useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Bell,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  ExternalLink,
  FolderTree,
  Image,
  LayoutDashboard,
  Leaf,
  LogOut,
  MapPin,
  Menu,
  Package,
  Plus,
  Settings2,
  ShoppingBag,
  Users,
  X,
} from "lucide-react";
import { dateTime, listOf, money, orderNumber } from "./api";
import { useStore } from "./context";
import { useResource } from "./hooks";
import { NotificationBell } from "./notification-feed";
import {
  Badge,
  Brand,
  EmptyState,
  ErrorState,
  Loading,
  PageHeading,
  ServiceStatus,
  Toast,
} from "./components";

const links = [
  ["/admin", "Overview", LayoutDashboard],
  ["/admin/products", "Products", Package],
  ["/admin/categories", "Categories", FolderTree],
  ["/admin/media", "Media library", Image],
  ["/admin/orders", "Orders", ShoppingBag],
  ["/admin/locations", "Delivery map", MapPin],
  ["/admin/customers", "Customers", Users],
  ["/admin/leads", "Leads & follow-ups", ClipboardList],
  ["/admin/inbox", "Your updates", Bell],
  ["/admin/notifications", "Notifications", Bell],
  ["/admin/staff", "Team & access", Users],
  ["/admin/settings", "Website & settings", Settings2],
  ["/admin/activity", "Activity history", Activity],
];
export function AdminLayout() {
  const {
    user,
    authLoading,
    logout,
    toast,
    setToast,
    liveConnected,
    settings,
  } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  if (authLoading) return <Loading label="Opening store studio…" />;
  if (!user)
    return (
      <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
    );
  if (user.role === "customer")
    return (
      <div className="container section">
        <EmptyState
          icon={Users}
          title="Store Studio is for authorised employees"
          message="Your account is a customer account. Sign out to use a staff account, or return to the store."
          action={
            <>
              <Link to="/" className="button primary">
                Back to store
              </Link>
              <button
                className="button secondary"
                onClick={async () => {
                  await logout();
                  navigate("/admin/login");
                }}
              >
                Sign out & use staff account
              </button>
            </>
          }
        />
      </div>
    );
  const available =
    user.role === "sales"
      ? links.filter(([path]) => path === "/admin/leads")
      : links;
  const title =
    [...links]
      .reverse()
      .find(
        ([path]) =>
          location.pathname === path ||
          (path !== "/admin" && location.pathname.startsWith(path + "/")),
      )?.[1] || "Store studio";
  return (
    <div className="admin-app">
      <a className="skip-link" href="#admin-content">
        Skip to main content
      </a>
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`admin-sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="admin-brand">
          <Brand small />
          <span className="studio-label">STORE STUDIO</span>
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <span className="nav-section-label">
          {user.role === "sales" ? "CUSTOMER RELATIONSHIPS" : "YOUR WORKSPACE"}
        </span>
        <nav aria-label="Admin navigation">
          {available.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/admin"}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link to="/" className="view-store">
            <ExternalLink size={17} />
            View storefront
          </Link>
          <div className="staff-user">
            <span>{user.name[0]?.toUpperCase()}</span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.role === "sales" ? "Sales Executive" : "Administrator"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={async () => {
                await logout();
                navigate("/admin/login");
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div>
            <button
              className="icon-button menu-toggle"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>Store studio</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="admin-topbar-right">
            <NotificationBell />
            <span className={`live-pill ${liveConnected ? "" : "offline"}`}>
              <i />
              {liveConnected ? "Live updates" : "Reconnecting"}
            </span>
            <Link to="/" className="button secondary small">
              Open store <ExternalLink size={14} />
            </Link>
          </div>
        </header>
        <main id="admin-content" className="admin-content">
          <Outlet />
        </main>
        <footer className="admin-footer">
          {settings.storeName || "Virar Organics"} · Made for the everyday{" "}
          <span>Store studio</span>
        </footer>
      </div>
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
export function AdminOnly({ children }) {
  const { user } = useStore();
  if (user?.role !== "admin") return <Navigate to="/admin/leads" replace />;
  return children;
}
export function AdminIndex() {
  const { user } = useStore();
  return user?.role === "sales" ? (
    <Navigate to="/admin/leads" replace />
  ) : (
    <Dashboard />
  );
}
export function Dashboard() {
  const { user, revision, config } = useStore();
  const result = useResource("/admin/dashboard", [revision]);
  const data = result.data || {};
  const lowStockItems =
    data.lowStockProducts ||
    (Array.isArray(data.lowStock) ? data.lowStock : []);
  return (
    <>
      <PageHeading
        eyebrow="A FRESH LOOK AT YOUR STORE"
        title={`Good to see you, ${user.name.split(" ")[0]}.`}
        description="See what is happening across your store today."
        actions={
          <Link to="/admin/products/new" className="button primary">
            <Plus size={17} />
            Add product
          </Link>
        }
      />
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : (
        <>
          <div className="metric-grid">
            {[
              [
                "Orders today",
                data.ordersToday || 0,
                ShoppingBag,
                "New orders placed today",
              ],
              [
                "Revenue this month",
                money(data.revenueMonth || 0),
                CircleDollarSign,
                "Delivered orders placed this month",
              ],
              [
                "New enquiries",
                data.newLeads || 0,
                Users,
                "Leads waiting for a first response",
              ],
              [
                "Follow-ups today",
                data.todayFollowups || 0,
                ClipboardList,
                "Due today or overdue conversations",
              ],
            ].map(([label, value, Icon, note]) => (
              <article className="metric-card" key={label}>
                <div>
                  <span>{label}</span>
                  <Icon size={21} />
                </div>
                <strong>{value}</strong>
                <small>{note}</small>
              </article>
            ))}
          </div>
          <div className="dashboard-grid">
            <section className="admin-card">
              <div className="admin-card-header">
                <div>
                  <h2>Recent orders</h2>
                  <p>The latest good things heading out.</p>
                </div>
                <Link className="text-link" to="/admin/orders">
                  View all <ArrowRight size={16} />
                </Link>
              </div>
              {data.recentOrders?.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Customer</th>
                        <th>Status</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentOrders.slice(0, 6).map((order) => (
                        <tr key={order.id}>
                          <td>
                            <Link
                              className="table-link"
                              to={`/admin/orders/${order.id}`}
                            >
                              {orderNumber(order.id)}
                            </Link>
                            <small>{dateTime(order.created_at)}</small>
                          </td>
                          <td>
                            {order.name || order.customer_name || "Customer"}
                          </td>
                          <td>
                            <Badge>{order.status}</Badge>
                          </td>
                          <td className="nowrap">{money(order.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={ShoppingBag}
                  title="No orders yet"
                  message="Customer orders will appear here."
                />
              )}
            </section>
            <section className="admin-card">
              <div className="admin-card-header">
                <div>
                  <h2>A little attention needed</h2>
                  <p>Keep your pantry ready.</p>
                </div>
                <Leaf size={22} />
              </div>
              {lowStockItems.length ? (
                <div className="low-stock-list">
                  {lowStockItems.slice(0, 5).map((product) => (
                    <Link to={`/admin/products/${product.id}`} key={product.id}>
                      <div>
                        <strong>{product.name}</strong>
                        <span>{product.unit || "Stock available"}</span>
                      </div>
                      <Badge variant={product.stock ? "pending" : "failed"}>
                        {product.stock} left
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="quiet-card">
                  <Leaf size={35} />
                  <strong>
                    {Number(data.lowStock) > 0
                      ? `${data.lowStock} products need attention`
                      : "Your shelves look good"}
                  </strong>
                  <p>
                    {Number(data.lowStock) > 0
                      ? "Open inventory to review products with five or fewer packs."
                      : "No low-stock products right now."}
                  </p>
                </div>
              )}
              <Link to="/admin/products" className="card-footer-link">
                Manage inventory <ArrowRight size={16} />
              </Link>
            </section>
          </div>
          <div className="dashboard-grid">
            <section className="admin-card">
              <div className="admin-card-header">
                <div>
                  <h2>Keep things moving</h2>
                  <p>Small tasks that make a good store.</p>
                </div>
              </div>
              <div className="quick-actions">
                <Link to="/admin/products/new">
                  <Package />
                  <span>
                    <strong>Add to the pantry</strong>
                    <small>Create a product with images</small>
                  </span>
                  <ArrowRight size={18} />
                </Link>
                <Link to="/admin/leads?due=today">
                  <ClipboardList />
                  <span>
                    <strong>Follow up with care</strong>
                    <small>See today’s customer conversations</small>
                  </span>
                  <ArrowRight size={18} />
                </Link>
                <Link to="/admin/settings">
                  <Settings2 />
                  <span>
                    <strong>Freshen up the storefront</strong>
                    <small>Banners, offers and store details</small>
                  </span>
                  <ArrowRight size={18} />
                </Link>
              </div>
            </section>
            <section className="admin-card">
              <div className="admin-card-header">
                <div>
                  <h2>Connected services</h2>
                  <p>Clear status for your local setup.</p>
                </div>
              </div>
              <div className="service-card-body">
                <ServiceStatus />
                <div className="service-row">
                  <span>Redis cache & queue</span>
                  <Badge variant={config.redis ? "active" : "failed"}>
                    {config.redis ? "Connected" : "Unavailable"}
                  </Badge>
                </div>
                <div className="service-row">
                  <span>Products</span>
                  <strong>{data.summary?.products || 0}</strong>
                </div>
                <div className="service-row">
                  <span>Customers</span>
                  <strong>{data.summary?.customers || 0}</strong>
                </div>
                <p className="muted">
                  Simulated messages and payments demonstrate the flow without
                  contacting a provider. Review notification records for each
                  event.
                </p>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
export function AdminActivity() {
  const { revision } = useStore();
  const [page, setPage] = useState(1);
  const result = useResource(`/admin/activity?page=${page}&limit=30`, [
    revision,
  ]);
  return (
    <>
      <PageHeading
        eyebrow="A CLEAR RECORD"
        title="Activity history"
        description="Important changes, with the person and time behind them."
      />
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : (
        <section className="admin-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {listOf(result.data).map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{dateTime(row.created_at)}</td>
                    <td>
                      {row.actor_name ||
                        row.name ||
                        (row.actor_id ? `User #${row.actor_id}` : "System")}
                    </td>
                    <td>
                      <Badge variant="neutral">
                        {row.action || row.entity_type || "Update"}
                      </Badge>
                    </td>
                    <td>
                      {typeof row.detail === "object"
                        ? JSON.stringify(row.detail)
                        : row.detail ||
                          row.description ||
                          (typeof row.metadata === "object"
                            ? JSON.stringify(row.metadata)
                            : row.metadata) ||
                          "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!listOf(result.data).length && (
            <EmptyState
              icon={Activity}
              title="No activity recorded yet"
              message="Store changes will be recorded here."
            />
          )}
          <div className="table-footer">
            <button
              className="button secondary small"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} · {result.data.total} records
            </span>
            <button
              className="button secondary small"
              disabled={page * 30 >= result.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </section>
      )}
    </>
  );
}
