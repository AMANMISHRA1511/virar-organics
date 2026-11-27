import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck, ChevronRight, Package } from "lucide-react";
import { api, dateTime } from "./api";
import { useStore } from "./context";
import { useResource } from "./hooks";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeading,
  Pagination,
} from "./components";

function FeedItems({ items, markRead, compact = false, onOpen }) {
  return (
    <div className={compact ? "inbox-items compact" : "inbox-items"}>
      {items.map((item) => (
        <article
          key={item.id}
          className={`inbox-item ${item.read_at ? "" : "unread"}`}
        >
          <span className="inbox-item-icon">
            <Package size={18} />
          </span>
          <div>
            <Link
              to={item.href || "#"}
              onClick={() => {
                if (!item.read_at) void markRead(item.id);
                onOpen?.();
              }}
            >
              <strong>{item.title}</strong>
              <ChevronRight size={14} />
            </Link>
            <p>{item.body}</p>
            <time dateTime={item.created_at}>{dateTime(item.created_at)}</time>
          </div>
          {!compact && !item.read_at && (
            <button
              type="button"
              className="link-button"
              onClick={() => markRead(item.id)}
              aria-label={`Mark ${item.title} as read`}
            >
              Mark read
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
export function NotificationBell() {
  const { user, revision, refresh, notify } = useStore();
  const allowed = user && ["customer", "admin"].includes(user.role);
  const result = useResource(
    allowed ? "/account/notifications?page=1&limit=6" : null,
    [revision],
  );
  const [open, setOpen] = useState(false);
  const wrapper = useRef(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event) => {
      if (!wrapper.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => setOpen(false), [user?.id]);
  if (!allowed) return null;
  const count = result.data?.unreadCount || 0;
  const markRead = async (id) => {
    try {
      await api(`/account/notifications/${id}`, {
        method: "PATCH",
        body: { read: true },
      });
      result.reload();
      refresh();
    } catch (error) {
      notify(error.message, "error");
    }
  };
  const allRead = async () => {
    try {
      await api("/account/notifications/read-all", {
        method: "POST",
        body: {},
      });
      result.reload();
      refresh();
    } catch (error) {
      notify(error.message, "error");
    }
  };
  return (
    <div className="notification-bell" ref={wrapper}>
      <button
        type="button"
        className="icon-button"
        aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <Bell size={21} />
        {count > 0 && (
          <span className="notification-count">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <section
          className="notification-popover"
          role="dialog"
          aria-label="Your updates"
        >
          <header>
            <h2>Your updates</h2>
            {count > 0 && (
              <button type="button" className="link-button" onClick={allRead}>
                Mark all read
              </button>
            )}
          </header>
          {result.loading ? (
            <Loading inline label="Loading updates…" />
          ) : result.error ? (
            <ErrorState error={result.error} retry={result.reload} />
          ) : !result.data?.items?.length ? (
            <p className="inbox-empty">
              You’re all caught up. New updates will appear here.
            </p>
          ) : (
            <FeedItems
              compact
              items={result.data.items}
              markRead={markRead}
              onOpen={() => setOpen(false)}
            />
          )}
          <Link
            className="notification-all"
            to={
              user.role === "admin" ? "/admin/inbox" : "/account/notifications"
            }
            onClick={() => setOpen(false)}
          >
            See all updates <ChevronRight size={15} />
          </Link>
        </section>
      )}
    </div>
  );
}
export function NotificationInbox() {
  const { revision, refresh, notify } = useStore();
  const [page, setPage] = useState(1),
    [unread, setUnread] = useState(false);
  const result = useResource(
    `/account/notifications?page=${page}&limit=20${unread ? "&unread=true" : ""}`,
    [revision],
  );
  const markRead = async (id) => {
    try {
      await api(`/account/notifications/${id}`, {
        method: "PATCH",
        body: { read: true },
      });
      result.reload();
      refresh();
    } catch (error) {
      notify(error.message, "error");
    }
  };
  const allRead = async () => {
    try {
      await api("/account/notifications/read-all", {
        method: "POST",
        body: {},
      });
      result.reload();
      refresh();
      notify("All updates marked as read.");
    } catch (error) {
      notify(error.message, "error");
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="KEEPING YOU IN THE KNOW"
        title="Your updates"
        description="Private updates about your account and orders, refreshed as things change."
        actions={
          result.data?.unreadCount > 0 && (
            <button className="button secondary" onClick={allRead}>
              <CheckCheck size={17} />
              Mark all read
            </button>
          )
        }
      />
      <label className="check-field inbox-filter">
        <input
          type="checkbox"
          checked={unread}
          onChange={(event) => {
            setUnread(event.target.checked);
            setPage(1);
          }}
        />
        <span>Unread updates only</span>
      </label>
      {result.loading ? (
        <Loading label="Loading your updates…" />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : !result.data?.items?.length ? (
        <EmptyState
          icon={Bell}
          title="You’re all caught up"
          message="Updates will appear here when there is something new to share."
        />
      ) : (
        <section className="form-card inbox-card">
          <FeedItems items={result.data.items} markRead={markRead} />
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
