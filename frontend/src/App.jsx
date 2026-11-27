import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { StoreProvider } from "./context";
import { StoreLayout } from "./components";
import {
  AboutPage,
  AccountLayout,
  AccountProfile,
  AuthPage,
  BulkEnquiry,
  CartPage,
  Checkout,
  ContactPage,
  Home,
  MyOrderDetail,
  MyOrders,
  NotFound,
  ProductDetail,
  RequireCustomer,
  Shop,
} from "./store";
import { AdminActivity, AdminIndex, AdminLayout, AdminOnly } from "./admin";
import {
  AdminCategories,
  AdminMedia,
  AdminProductEditor,
  AdminProducts,
} from "./admin-products";
import {
  AdminLocations,
  AdminNotifications,
  AdminOrderDetail,
  AdminOrders,
} from "./admin-orders";
import { AdminLeads, AdminStaff } from "./admin-crm";
import { AdminSettings } from "./admin-settings";
import { AccountAddresses } from "./addresses";
import { NotificationInbox } from "./notification-feed";
import { ForgotPasswordPage, ResetPasswordPage } from "./password-recovery";
import { OrderInvoicePage } from "./invoice";
import { AdminCustomers, AdminCustomerDetail } from "./admin-customers";
class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="container section">
          <h1>This page needs a fresh start.</h1>
          <p>
            Your saved account and orders are still on the server. Reload the
            page to reconnect.
          </p>
          <button
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </main>
      );
    return this.props.children;
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <StoreProvider>
          <Routes>
            <Route path="invoice/:id" element={<OrderInvoicePage />} />
            <Route element={<StoreLayout />}>
              <Route index element={<Home />} />
              <Route path="shop" element={<Shop />} />
              <Route path="products/:id" element={<ProductDetail />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="login" element={<AuthPage />} />
              <Route path="register" element={<AuthPage register />} />
              <Route path="forgot-password" element={<ForgotPasswordPage />} />
              <Route path="reset-password" element={<ResetPasswordPage />} />
              <Route path="admin/login" element={<AuthPage staff />} />
              <Route path="bulk" element={<BulkEnquiry />} />
              <Route path="enquiry" element={<BulkEnquiry />} />
              <Route path="about" element={<AboutPage />} />
              <Route path="contact" element={<ContactPage />} />
              <Route element={<RequireCustomer />}>
                <Route path="checkout" element={<Checkout />} />
                <Route path="account" element={<AccountLayout />}>
                  <Route index element={<AccountProfile />} />
                  <Route path="addresses" element={<AccountAddresses />} />
                  <Route path="notifications" element={<NotificationInbox />} />
                  <Route path="orders" element={<MyOrders />} />
                  <Route path="orders/:id" element={<MyOrderDetail />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<AdminIndex />} />
              <Route
                path="products"
                element={
                  <AdminOnly>
                    <AdminProducts />
                  </AdminOnly>
                }
              />
              <Route
                path="products/new"
                element={
                  <AdminOnly>
                    <AdminProductEditor />
                  </AdminOnly>
                }
              />
              <Route
                path="products/:id"
                element={
                  <AdminOnly>
                    <AdminProductEditor />
                  </AdminOnly>
                }
              />
              <Route
                path="categories"
                element={
                  <AdminOnly>
                    <AdminCategories />
                  </AdminOnly>
                }
              />
              <Route
                path="media"
                element={
                  <AdminOnly>
                    <AdminMedia />
                  </AdminOnly>
                }
              />
              <Route
                path="orders"
                element={
                  <AdminOnly>
                    <AdminOrders />
                  </AdminOnly>
                }
              />
              <Route
                path="orders/:id"
                element={
                  <AdminOnly>
                    <AdminOrderDetail />
                  </AdminOnly>
                }
              />
              <Route
                path="locations"
                element={
                  <AdminOnly>
                    <AdminLocations />
                  </AdminOnly>
                }
              />
              <Route
                path="customers"
                element={
                  <AdminOnly>
                    <AdminCustomers />
                  </AdminOnly>
                }
              />
              <Route
                path="customers/:id"
                element={
                  <AdminOnly>
                    <AdminCustomerDetail />
                  </AdminOnly>
                }
              />
              <Route
                path="inbox"
                element={
                  <AdminOnly>
                    <NotificationInbox />
                  </AdminOnly>
                }
              />
              <Route path="leads" element={<AdminLeads />} />
              <Route
                path="notifications"
                element={
                  <AdminOnly>
                    <AdminNotifications />
                  </AdminOnly>
                }
              />
              <Route
                path="staff"
                element={
                  <AdminOnly>
                    <AdminStaff />
                  </AdminOnly>
                }
              />
              <Route
                path="settings"
                element={
                  <AdminOnly>
                    <AdminSettings />
                  </AdminOnly>
                }
              />
              <Route
                path="activity"
                element={
                  <AdminOnly>
                    <AdminActivity />
                  </AdminOnly>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </StoreProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
