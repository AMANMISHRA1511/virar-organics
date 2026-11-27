import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapPin, Package, Users } from "lucide-react";
import { dateTime, makeQuery, money, orderNumber } from "./api";
import { useStore } from "./context";
import { useDebounced, useResource } from "./hooks";
import {
  BackLink,
  Badge,
  EmptyState,
  ErrorState,
  Loading,
  PageHeading,
  Pagination,
  SearchBox,
} from "./components";
import { AddressCard } from "./addresses";

export function AdminCustomers() {
  const { revision } = useStore();
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const q = useDebounced(search);
  const result = useResource(
    `/admin/customers?${makeQuery({ q, page, limit: 20 })}`,
    [revision],
  );
  useEffect(() => setPage(1), [q]);
  return (
    <>
      <PageHeading
        eyebrow="THE PEOPLE IN YOUR COMMUNITY"
        title="Customers"
        description="Customer accounts, saved delivery details and order history in one place."
      />
      <div className="admin-toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search name, email or phone…"
          label="Search customers"
        />
      </div>
      {result.loading ? (
        <Loading label="Loading customers…" />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : !result.data?.items?.length ? (
        <EmptyState
          icon={Users}
          title="No matching customers"
          message="Customer accounts appear here after registration. Try another search."
        />
      ) : (
        <section className="admin-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Orders</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link
                        className="table-title"
                        to={`/admin/customers/${customer.id}`}
                      >
                        {customer.name}
                      </Link>
                      <small className="table-secondary">
                        {customer.active === false
                          ? "Account disabled"
                          : "Customer account"}
                      </small>
                    </td>
                    <td>
                      {customer.email}
                      <small className="table-secondary">
                        {customer.phone || "No phone provided"}
                      </small>
                    </td>
                    <td>
                      {customer.order_count ?? customer.orders_count ?? 0}
                    </td>
                    <td>{dateTime(customer.created_at)}</td>
                    <td>
                      <Link
                        className="button secondary small"
                        to={`/admin/customers/${customer.id}`}
                      >
                        View customer
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            total={result.data.total}
            limit={20}
            onPage={setPage}
          />
        </section>
      )}
    </>
  );
}
export function AdminCustomerDetail() {
  const { id } = useParams(),
    { revision } = useStore();
  const result = useResource(`/admin/customers/${id}`, [revision]);
  if (result.loading) return <Loading label="Loading customer details…" />;
  if (result.error)
    return <ErrorState error={result.error} retry={result.reload} />;
  if (!result.data) return null;
  const { customer, addresses = [], orders = [], leads = [] } = result.data;
  return (
    <>
      <BackLink to="/admin/customers">All customers</BackLink>
      <PageHeading
        eyebrow="CUSTOMER ACCOUNT"
        title={customer.name}
        description="Delivery details and history are shared with authorised store administrators."
      />
      <div className="customer-directory-layout">
        <section className="admin-card form-section">
          <h2>Account details</h2>
          <dl className="customer-facts">
            <div>
              <dt>Email</dt>
              <dd>{customer.email}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{customer.phone || "Not provided"}</dd>
            </div>
            <div>
              <dt>Phone verification</dt>
              <dd>
                {customer.phone_verified ? (
                  <Badge variant="delivered">SMS verified</Badge>
                ) : customer.phone_verification_method === "simulated" ? (
                  <Badge variant="pending">Demo checked · not verified</Badge>
                ) : (
                  "Not verified"
                )}
              </dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>{dateTime(customer.created_at)}</dd>
            </div>
          </dl>
        </section>
        <section className="admin-card form-section">
          <h2>Saved delivery addresses</h2>
          {addresses.length ? (
            <div className="saved-address-grid">
              {addresses.map((address) => (
                <AddressCard key={address.id} address={address} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={MapPin}
              title="No saved addresses yet"
              message="The customer can save an address in their account or at checkout."
            />
          )}
        </section>
      </div>
      <section className="admin-card">
        <div className="card-header">
          <h2>Recent orders</h2>
          <Package size={20} />
        </div>
        {orders.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link
                        className="table-title"
                        to={`/admin/orders/${order.id}`}
                      >
                        {orderNumber(order.id)}
                      </Link>
                    </td>
                    <td>{dateTime(order.created_at)}</td>
                    <td>
                      <Badge>{order.status}</Badge>
                    </td>
                    <td>{money(order.total)}</td>
                    <td>
                      <Link
                        to={`/admin/orders/${order.id}`}
                        className="link-button"
                      >
                        View order
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-table-copy">
            This customer has not placed an order yet.
          </p>
        )}
      </section>
      <section className="admin-card">
        <div className="card-header">
          <h2>Bulk enquiries</h2>
        </div>
        {leads.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product / enquiry</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      {lead.product}
                      <small className="table-secondary">
                        {lead.quantity} packs / units
                      </small>
                    </td>
                    <td>
                      <Badge>{lead.status}</Badge>
                    </td>
                    <td>{dateTime(lead.created_at)}</td>
                    <td>
                      <Link
                        to={`/admin/leads?q=${encodeURIComponent(lead.name || customer.name)}`}
                        className="link-button"
                      >
                        Open leads
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-table-copy">No linked enquiries yet.</p>
        )}
      </section>
    </>
  );
}
