import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  ClipboardList,
  KeyRound,
  MessageSquare,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { api, dateInput, dateOnly, dateTime, listOf, makeQuery } from "./api";
import { useStore } from "./context";
import { useDebounced, useResource } from "./hooks";
import {
  Badge,
  CsvLink,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  InlineNotice,
  Loading,
  Modal,
  PageHeading,
  Pagination,
  SearchBox,
  SubmitButton,
} from "./components";

export function AdminLeads() {
  const { revision, notify, refresh } = useStore();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") || "");
  const q = useDebounced(search);
  const [status, setStatus] = useState("");
  const [due, setDue] = useState(params.get("due") === "today");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = makeQuery({ q, status, due: due ? "today" : "" });
  const result = useResource(`/admin/leads?${query}&page=${page}&limit=15`, [
    revision,
  ]);
  useEffect(() => setPage(1), [q, status, due]);
  const open = async (lead) => {
    setError("");
    if (lead?.id) {
      try {
        const detail = await api(`/admin/leads/${lead.id}`);
        setEdit({ ...detail, followup: dateInput(detail.followup), note: "" });
      } catch (err) {
        notify(err.message, "error");
      }
    } else
      setEdit({
        name: "",
        email: "",
        phone: "",
        product: "",
        quantity: 1,
        message: "",
        status: "New",
        followup: "",
        note: "",
        notes: [],
      });
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        name: edit.name,
        email: edit.email,
        phone: edit.phone,
        product: edit.product,
        quantity: Number(edit.quantity),
        message: edit.message || "",
        status: edit.status,
        followup: edit.followup || null,
        note: edit.note || "",
      };
      await api(edit.id ? `/admin/leads/${edit.id}` : "/admin/leads", {
        method: edit.id ? "PATCH" : "POST",
        body,
      });
      setEdit(null);
      result.reload();
      refresh();
      notify(
        edit.id ? "Lead updated. Every follow-up counts." : "New lead added.",
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="GOOD RELATIONSHIPS TAKE CARE"
        title="Leads & follow-ups"
        description="Pick up a conversation, leave a useful note, and keep the next step clear."
        actions={
          <>
            <CsvLink href={`/admin/leads/export?${query}`} />
            <button className="button primary" onClick={() => open()}>
              <Plus size={17} />
              Add lead
            </button>
          </>
        }
      />
      <section className="admin-card">
        <div className="admin-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search name, email or product…"
            label="Search leads"
          />
          <select
            aria-label="Filter lead status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Every lead status</option>
            {["New", "Contacted", "Converted", "Lost"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <label className="check-field due-filter">
            <input
              type="checkbox"
              checked={due}
              onChange={(event) => setDue(event.target.checked)}
            />
            <CalendarDays size={16} />
            <span>Due today & overdue</span>
          </label>
        </div>
        {result.loading ? (
          <Loading />
        ) : result.error ? (
          <ErrorState error={result.error} retry={result.reload} />
        ) : listOf(result.data).length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Interest</th>
                    <th>Status</th>
                    <th>Follow-up</th>
                    <th>Latest note</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {listOf(result.data).map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <button
                          className="table-link"
                          onClick={() => open(lead)}
                        >
                          {lead.name}
                        </button>
                        <small>{lead.email}</small>
                        <small>{lead.phone}</small>
                      </td>
                      <td>
                        <strong>{lead.product}</strong>
                        <small>{lead.quantity} packs / units</small>
                      </td>
                      <td>
                        <Badge>{lead.status}</Badge>
                      </td>
                      <td className="nowrap">{dateOnly(lead.followup)}</td>
                      <td className="note-cell">
                        {Array.isArray(lead.notes) && lead.notes.length
                          ? lead.notes[lead.notes.length - 1].note
                          : "No notes yet"}
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Edit lead ${lead.name}`}
                          onClick={() => open(lead)}
                        >
                          <Pencil size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={result.data.total}
              limit={15}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            icon={ClipboardList}
            title={
              due ? "A little breathing room today" : "No leads in this view"
            }
            message={
              due
                ? "No follow-ups match your filters for today."
                : "Bulk enquiries arrive here automatically. You can also create a lead yourself."
            }
            action={
              <button className="button secondary" onClick={() => open()}>
                Add a lead
              </button>
            }
          />
        )}
      </section>
      {edit && (
        <Modal
          title={edit.id ? `Lead · ${edit.name}` : "Add a lead"}
          onClose={() => setEdit(null)}
          wide
        >
          <form className="form-stack" onSubmit={save}>
            <div className="form-grid">
              <Field label="Customer name">
                <input
                  required
                  maxLength={100}
                  value={edit.name}
                  onChange={(event) =>
                    setEdit({ ...edit, name: event.target.value })
                  }
                />
              </Field>
              <Field label="Email">
                <input
                  required
                  type="email"
                  maxLength={190}
                  value={edit.email}
                  onChange={(event) =>
                    setEdit({ ...edit, email: event.target.value })
                  }
                />
              </Field>
              <Field label="Phone">
                <input
                  required
                  type="tel"
                  maxLength={30}
                  value={edit.phone}
                  onChange={(event) =>
                    setEdit({ ...edit, phone: event.target.value })
                  }
                />
              </Field>
              <Field label="Product / interest">
                <input
                  required
                  maxLength={150}
                  value={edit.product}
                  onChange={(event) =>
                    setEdit({ ...edit, product: event.target.value })
                  }
                />
              </Field>
              <Field label="Quantity">
                <input
                  required
                  type="number"
                  min="1"
                  max="100000"
                  value={edit.quantity}
                  onChange={(event) =>
                    setEdit({ ...edit, quantity: event.target.value })
                  }
                />
              </Field>
              <Field label="Status">
                <select
                  value={edit.status}
                  onChange={(event) =>
                    setEdit({ ...edit, status: event.target.value })
                  }
                >
                  {["New", "Contacted", "Converted", "Lost"].map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </Field>
              <Field label="Follow-up date">
                <input
                  type="date"
                  value={edit.followup || ""}
                  onChange={(event) =>
                    setEdit({ ...edit, followup: event.target.value })
                  }
                />
              </Field>
              <Field label="Customer’s message" className="span-2">
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={edit.message || ""}
                  onChange={(event) =>
                    setEdit({ ...edit, message: event.target.value })
                  }
                />
              </Field>
            </div>
            {Array.isArray(edit.notes) && edit.notes.length > 0 && (
              <section className="lead-notes">
                <h3>Conversation notes</h3>
                {edit.notes.map((note) => (
                  <div key={note.id}>
                    <MessageSquare size={16} />
                    <div>
                      <p>{note.note}</p>
                      <small>
                        {note.actor_name || "Staff"} ·{" "}
                        {dateTime(note.created_at)}
                      </small>
                    </div>
                  </div>
                ))}
              </section>
            )}
            <Field
              label="Add a note"
              hint="Saved notes keep their author and timestamp."
            >
              <textarea
                rows={3}
                maxLength={2000}
                value={edit.note || ""}
                onChange={(event) =>
                  setEdit({ ...edit, note: event.target.value })
                }
                placeholder="What did you discuss? What happens next?"
              />
            </Field>
            <FormError error={error} />
            <div className="form-actions">
              <SubmitButton busy={busy}>
                <Save size={16} />
                Save lead
              </SubmitButton>
              <button
                type="button"
                className="button secondary"
                onClick={() => setEdit(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function AdminStaff() {
  const { revision, notify, refresh, user } = useStore();
  const result = useResource("/admin/staff", [revision]);
  const [edit, setEdit] = useState(null);
  const [passwordFor, setPasswordFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = (staff) => {
    setError("");
    setEdit(
      staff
        ? { ...staff, active: Boolean(staff.active) }
        : {
            name: "",
            email: "",
            phone: "",
            password: "",
            role: "sales",
            active: true,
          },
    );
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = edit.id
        ? {
            name: edit.name,
            phone: edit.phone,
            role: edit.role,
            active: edit.active,
          }
        : edit;
      await api(edit.id ? `/admin/staff/${edit.id}` : "/admin/staff", {
        method: edit.id ? "PATCH" : "POST",
        body,
      });
      setEdit(null);
      result.reload();
      refresh();
      notify("Staff account saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="THE PEOPLE BEHIND THE PANTRY"
        title="Team & access"
        description="Only administrators can create employee accounts and manage their access."
        actions={
          <button className="button primary" onClick={() => open()}>
            <UserPlus size={17} />
            Add staff member
          </button>
        }
      />
      <div className="role-explanation">
        <div>
          <ShieldCheck size={23} />
          <span>
            <strong>Administrator</strong>
            <small>
              Full store access, employee accounts and customer records
            </small>
          </span>
        </div>
        <div>
          <ClipboardList size={23} />
          <span>
            <strong>Sales Executive</strong>
            <small>Employee access to leads and follow-ups only</small>
          </span>
        </div>
      </div>
      <InlineNotice>
        Customers register through the storefront. Employee accounts are created
        here by an Administrator. The last active Administrator cannot be
        disabled or changed to Sales Executive. Disabling, changing a role or
        resetting a password revokes old sessions.
      </InlineNotice>
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
                  <th>Staff member</th>
                  <th>Role</th>
                  <th>Access</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listOf(result.data).map((staff) => (
                  <tr key={staff.id}>
                    <td>
                      <strong>
                        {staff.name}
                        {staff.id === user.id ? " (you)" : ""}
                      </strong>
                      <small>{staff.email}</small>
                      <small>{staff.phone}</small>
                    </td>
                    <td>
                      {staff.role === "admin"
                        ? "Administrator"
                        : "Sales Executive"}
                    </td>
                    <td>
                      <Badge variant={staff.active ? "active" : "neutral"}>
                        {staff.active ? "Active" : "Disabled"}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="button secondary small"
                          onClick={() => open(staff)}
                        >
                          <Pencil size={14} />
                          Edit access
                        </button>
                        <button
                          className="button secondary small"
                          onClick={() => {
                            setPasswordFor(staff);
                            setError("");
                          }}
                        >
                          <KeyRound size={14} />
                          Reset password
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {edit && (
        <Modal
          title={edit.id ? "Edit staff access" : "Add staff member"}
          onClose={() => setEdit(null)}
        >
          <form className="form-stack" onSubmit={save}>
            <Field label="Full name">
              <input
                required
                maxLength={100}
                value={edit.name}
                onChange={(event) =>
                  setEdit({ ...edit, name: event.target.value })
                }
              />
            </Field>
            <Field label="Email address">
              <input
                required
                type="email"
                maxLength={190}
                readOnly={Boolean(edit.id)}
                value={edit.email}
                onChange={(event) =>
                  setEdit({ ...edit, email: event.target.value })
                }
              />
            </Field>
            <Field label="Phone">
              <input
                required
                type="tel"
                maxLength={30}
                value={edit.phone || ""}
                onChange={(event) =>
                  setEdit({ ...edit, phone: event.target.value })
                }
              />
            </Field>
            {!edit.id && (
              <Field
                label="Initial password"
                hint="10–72 characters. Share it with the staff member securely."
              >
                <input
                  required
                  type="password"
                  minLength={10}
                  maxLength={72}
                  autoComplete="new-password"
                  value={edit.password}
                  onChange={(event) =>
                    setEdit({ ...edit, password: event.target.value })
                  }
                />
              </Field>
            )}
            <Field label="Role">
              <select
                value={edit.role}
                onChange={(event) =>
                  setEdit({ ...edit, role: event.target.value })
                }
              >
                <option value="sales">Sales Executive · CRM only</option>
                <option value="admin">Administrator · full store access</option>
              </select>
            </Field>
            {edit.id && (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={edit.active}
                  onChange={(event) =>
                    setEdit({ ...edit, active: event.target.checked })
                  }
                />
                <span>Allow this staff member to sign in</span>
              </label>
            )}
            <FormError error={error} />
            <SubmitButton busy={busy}>Save staff account</SubmitButton>
          </form>
        </Modal>
      )}
      {passwordFor && (
        <Modal
          title={`Reset password · ${passwordFor.name}`}
          onClose={() => setPasswordFor(null)}
        >
          <p>
            Old sessions will be revoked. Share the new password through a
            secure channel.
          </p>
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              const values = Object.fromEntries(
                new FormData(event.currentTarget),
              );
              try {
                await api(`/admin/staff/${passwordFor.id}/password`, {
                  method: "POST",
                  body: values,
                });
                setPasswordFor(null);
                result.reload();
                notify("Password reset. Previous sessions have been revoked.");
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="New password">
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={72}
                required
              />
            </Field>
            <FormError error={error} />
            <SubmitButton busy={busy}>Reset password</SubmitButton>
          </form>
        </Modal>
      )}
    </>
  );
}
