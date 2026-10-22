import { useEffect, useState, type ReactNode } from "react";
import { useApi } from "../../lib/context";
import { CHANNEL_LABEL, fmtDateTime, fmtDay, fmtKobo, fmtTime } from "../../lib/format";
import { useAction, useQuery, useStream } from "../../lib/hooks";
import { useProduct, useProductNames } from "../../lib/products";
import {
  CHANNELS,
  CONTACT_CHANNELS,
  type Channel,
  type Consent,
  type Customer,
  type Message,
  type RespondAction,
  type RewardsAccount,
  type Transaction,
} from "../../lib/types";

type Tab = "home" | "history" | "offers" | "inbox" | "more";
type MoreView = "rewards" | "privacy" | null;

const ICONS = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  offers: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  inbox: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9z" /><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><path d="M4 4l16 16" /></>,
  gift: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v8h14v-8M12 8v12M12 8S10.5 3 8 4.5 9 8 12 8zM12 8s1.5-5 4-3.5S15 8 12 8z" /></>,
  shield: <path d="M12 21s7.5-3.5 7.5-9.5V5.5L12 3 4.5 5.5v6C4.5 17.5 12 21 12 21z" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
} satisfies Record<string, ReactNode>;

function Icon({ name, size = 20 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const isPending = (m: Message) => m.status === "delivered" || m.status === "opened";
const newestFirst = (a: Message, b: Message) => Date.parse(b.delivered_at) - Date.parse(a.delivered_at);

/** The customer's banking app: account, history and recommendations, plus the endpoints in api_design.md 5.2. */
export function Phone({ customer }: { customer: Customer }) {
  const api = useApi();
  const ref = customer.customer_ref;
  const [tab, setTab] = useState<Tab>("home");
  const [moreView, setMoreView] = useState<MoreView>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const inbox = useQuery(() => api.inbox(ref), [ref]);
  const profile = useQuery(() => api.customer(ref), [ref]);
  const consent = useQuery(() => api.consent(ref), [ref]);
  const rewards = useQuery(() => api.rewards(ref), [ref]);
  const account = useQuery(() => api.transactions(ref), [ref]);

  // The API doesn't announce every customer action on the stream, so refresh after our own
  const refreshAll = () => {
    inbox.reload();
    profile.reload();
    consent.reload();
    rewards.reload();
  };

  useStream((e) => {
    if (e.data.customer_ref !== ref) return;
    if (e.type === "message_delivered") setBanner(String(e.data.message_id ?? ""));
    if (e.type === "message_delivered" || e.type === "outcome_recorded") {
      inbox.reload();
      profile.reload();
    }
    if (e.type === "transaction_posted") account.reload();
    if (e.type === "consent_changed") consent.reload();
    if (e.type === "points_awarded" || e.type === "points_redeemed" || e.type === "tier_changed") rewards.reload();
  });

  useEffect(() => {
    if (banner === null) return;
    const t = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(t);
  }, [banner]);

  const messages = [...(inbox.data?.items ?? [])].sort(newestFirst);
  const unread = messages.filter((m) => m.status === "delivered").length;
  const open = messages.find((m) => m.id === openId);
  // A live event may not carry the message ID; then the newest message is the one that arrived
  const arrived = banner === null ? undefined : messages.find((m) => m.id === banner) ?? (banner === "" ? messages[0] : undefined);

  const go = (next: Tab, view: MoreView = null) => {
    setOpenId(null);
    setMoreView(view);
    setTab(next);
  };
  const toPrivacy = () => go("more", "privacy");

  return (
    <div className="phone" aria-label="Customer banking app">
      <div className="phone-screen">
        <div className="phone-notch" aria-hidden />
        <div className="phone-status">
          <span>9:41</span>
          <span>●●● 5G</span>
        </div>

        {arrived && arrived.status !== "scheduled" && (
          <button type="button" className="p-banner" onClick={() => { setBanner(null); go("home"); }}>
            <span className="p-banner-app">{arrived.channel === "app" ? "Zenith Bank" : `${CHANNEL_LABEL[arrived.channel]} · Zenith Bank`}<span>now</span></span>
            <strong>{arrived.title}</strong>
          </button>
        )}

        {open ? (
          <MessageView message={open} onBack={() => setOpenId(null)} onSettings={toPrivacy} onChanged={refreshAll} />
        ) : tab === "more" && moreView ? (
          <>
            <div className="phone-head">
              <button type="button" className="p-link" onClick={() => setMoreView(null)}>← More</button>
              <h2 style={{ marginTop: 6 }}>{moreView === "rewards" ? "Rewards" : "Privacy"}</h2>
            </div>
            <div className="phone-body">
              {moreView === "rewards" ? (
                <RewardsTab customerRef={ref} account={rewards.data} error={rewards.error?.message} onChanged={rewards.reload} />
              ) : (
                <SettingsTab customerRef={ref} consent={consent.data} error={consent.error?.message} onSaved={refreshAll} />
              )}
            </div>
          </>
        ) : (
          <>
            <div className="phone-head p-head">
              {tab === "home" ? (
                <span className="p-avatar" aria-hidden>{initials(customer.name)}</span>
              ) : (
                <button type="button" className="p-back" onClick={() => go("home")} aria-label="Back to Home">
                  <Icon name="back" />
                </button>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="muted small">{tab === "home" ? "Good morning," : TAB_TITLE[tab]}</div>
                <h2>{tab === "home" ? customer.name.split(" ")[0] : TAB_HEADING[tab]}</h2>
              </div>
              <button type="button" className="p-bell" onClick={() => go("inbox")} aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}>
                <Icon name="bell" />
                {unread > 0 && <span className="p-badge">{unread}</span>}
              </button>
            </div>
            <div className="phone-body">
              {tab === "home" && (
                <HomeTab
                  holdings={profile.data?.holdings ?? customer.holdings}
                  account={account.data}
                  accountError={account.error?.message}
                  pending={messages.find(isPending)}
                  onChanged={refreshAll}
                  onOpen={setOpenId}
                  go={go}
                />
              )}
              {tab === "history" && <HistoryTab transactions={account.data?.items} error={account.error?.message} />}
              {tab === "inbox" && <InboxTab messages={messages} loading={inbox.loading && !inbox.data} error={inbox.error?.message} onOpen={setOpenId} />}
              {tab === "offers" && <ForYouTab customerRef={ref} refreshKey={`${consent.data?.personalised_offers}|${profile.data?.holdings.length}`} onPrivacy={toPrivacy} />}
              {tab === "more" && <MoreTab customer={customer} accountNo={account.data?.account_no} rewards={rewards.data} consent={consent.data} onOpen={(v) => setMoreView(v)} />}
            </div>
          </>
        )}

        <nav className="phone-tabs">
          {([
            ["home", "home", "Home"],
            ["history", "history", "History"],
            ["offers", "offers", "Offers"],
            ["inbox", "inbox", "Inbox"],
            ["more", "more", "More"],
          ] as const).map(([value, icon, label]) => (
            <button key={value} type="button" className={tab === value && !open ? "active" : ""} onClick={() => go(value)}>
              <span className="ico">
                <Icon name={icon} size={20} />
                {value === "inbox" && unread > 0 && <span className="p-badge">{unread}</span>}
              </span>
              {label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

const TAB_TITLE: Record<Tab, string> = { home: "", history: "Current account", offers: "Picked for you", inbox: "Messages", more: "Settings" };
const TAB_HEADING: Record<Tab, string> = { home: "", history: "Transactions", offers: "Offers", inbox: "Inbox", more: "More" };

function HomeTab({
  holdings,
  account,
  accountError,
  pending,
  onChanged,
  onOpen,
  go,
}: {
  holdings: string[];
  account?: { account_no: string; balance_kobo: number; items: Transaction[] };
  accountError?: string;
  pending?: Message;
  onChanged: () => void;
  onOpen: (id: string) => void;
  go: (tab: Tab, view?: MoreView) => void;
}) {
  const productName = useProductNames();
  const [hidden, setHidden] = useState(false);
  // Kept here, not in the card: answering the offer reloads the inbox and the card goes away
  const [done, setDone] = useState<string | null>(null);
  // Stamp duty and alert fees stay in History; Home shows the payments people recognise
  const recent = account?.items.filter((t) => t.kind !== "stamp_duty" && t.kind !== "charge").slice(0, 5) ?? [];

  useEffect(() => {
    if (pending) setDone(null);
  }, [pending?.id]);

  return (
    <div className="stack-sm">
      <div className="p-balance">
        <div className="row-between">
          <span className="lbl">Current account{account ? ` · ${account.account_no}` : ""}</span>
          <button type="button" className="p-eye" onClick={() => setHidden(!hidden)} aria-label={hidden ? "Show balance" : "Hide balance"}>
            <Icon name={hidden ? "eyeOff" : "eye"} size={18} />
          </button>
        </div>
        <div className="amt">{account ? (hidden ? "₦ ••••••" : fmtKobo(account.balance_kobo)) : "…"}</div>
        <div className="lbl">Available balance</div>
      </div>

      {done && (
        <div className="p-ok row" style={{ gap: 8 }}>
          <Icon name="check" size={16} />
          {done}
        </div>
      )}
      {pending && <Recommendation key={pending.id} message={pending} onDone={(text) => { setDone(text); onChanged(); }} onOpen={onOpen} />}

      <div className="p-quick">
        {([
          ["history", "history", "History", null],
          ["offers", "offers", "Offers", null],
          ["more", "gift", "Rewards", "rewards"],
          ["more", "shield", "Privacy", "privacy"],
        ] as const).map(([tab, icon, label, view]) => (
          <button key={label} type="button" onClick={() => go(tab, view)}>
            <span className="p-quick-ico"><Icon name={icon} /></span>
            {label}
          </button>
        ))}
      </div>

      <div className="p-section row-between">
        <span>Recent transactions</span>
        <button type="button" className="p-link" onClick={() => go("history")}>See all</button>
      </div>
      {accountError ? (
        <div className="p-alert">{accountError}</div>
      ) : (
        <div className="p-card p-list">
          {recent.length ? recent.map((t) => <TxnRow key={t.id} t={t} />) : <p className="p-msg-meta" style={{ padding: 12 }}>{account ? "No transactions yet." : "Loading…"}</p>}
        </div>
      )}

      <div className="p-section">Your products</div>
      <div className="p-card p-list">
        {holdings.map((h) => (
          <div key={h} className="row-between p-row">
            <span>{productName(h)}</span>
            <span className="p-tag p-tag-ok">Active</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

/** The latest offer, shown in the app: what it is, what the customer gets, and why they're seeing it. */
function Recommendation({ message: m, onDone, onOpen }: { message: Message; onDone: (text: string) => void; onOpen: (id: string) => void }) {
  const api = useApi();
  const product = useProduct();
  const productName = useProductNames();
  const [respond, respondState] = useAction(api.respond);
  const why = useQuery(() => api.why(m.id), [m.id]);

  const name = productName(m.product_id);
  const features = product(m.product_id)?.features ?? [];
  const act = async (action: "accepted" | "not_now") => {
    if (await respond(m.id, action)) onDone(action === "accepted" ? `${name} is now on your account.` : "OK. We won't show this offer again for a while.");
  };

  return (
    <div className="p-reco">
      <div className="row-between">
        <span className="p-reco-tag">Recommended for you</span>
        <span className="p-msg-meta" style={{ marginTop: 0 }}>{m.channel === "app" ? fmtDay(m.delivered_at) : `Also sent on ${CHANNEL_LABEL[m.channel]}`}</span>
      </div>
      <div>
        <div className="p-reco-name">{name}</div>
        <div className="p-msg-meta" style={{ fontSize: 13 }}>{m.title}</div>
      </div>

      <div className="stack-sm" style={{ gap: 6 }}>
        <div className="p-reco-label">What you get</div>
        {/* The API puts the benefit in the message body; the catalogue features say it when we have them */}
        {!m.gain && !features.length && <p style={{ fontSize: 13.5 }}>{m.body}</p>}
        {m.gain && (
          <div className="p-gain">
            About <strong>{naira(m.gain.amount_ngn)}</strong> in {m.gain.period_months} months
            <div className="p-msg-meta">{m.gain.basis}</div>
          </div>
        )}
        {features.length > 0 && (
          <ul className="p-ticks">
            {features.map((f) => <li key={f}><Icon name="check" size={14} />{f}</li>)}
          </ul>
        )}
      </div>

      <div className="p-why stack-sm" style={{ gap: 6 }}>
        <div className="p-reco-label">Why you're seeing this</div>
        <span>{plainWhy(why.data?.why || m.why)}</span>
        {why.data && why.data.data_categories.length > 0 && (
          <div className="row" style={{ gap: 6 }}>
            {why.data.data_categories.map((c) => <span key={c} className="p-tag p-tag-grey">{c}</span>)}
          </div>
        )}
      </div>

      {respondState.error && <div className="p-alert">{respondState.error.message}</div>}
      <div className="p-reco-actions">
        <button type="button" className="p-btn p-btn-primary" disabled={respondState.loading} onClick={() => act("accepted")}>Get started</button>
        <button type="button" className="p-btn" disabled={respondState.loading} onClick={() => act("not_now")}>Not now</button>
      </div>
      <button type="button" className="p-link" style={{ alignSelf: "center", fontSize: 12.5 }} onClick={() => onOpen(m.id)}>Read the full message</button>
    </div>
  );
}

function txnTitle(t: Transaction): string {
  if (t.narration.startsWith("SCHOOL FEES")) return "School fees";
  if (t.narration.includes("ALLOWANCE")) return "Allowance";
  if (t.narration.includes("BOOKS")) return "Books and course materials";
  if (t.narration.startsWith("WEB PMT/USD")) return "Online payment in USD";
  switch (t.kind) {
    case "salary": return "Salary";
    case "nip_in": return "Transfer received";
    case "nip_out": return "Transfer sent";
    case "pos": return t.direction === "credit" ? "POS sales" : "Card payment";
    case "atm": return "ATM withdrawal";
    case "bill": return "Bill payment";
    case "airtime": return "Airtime";
    case "charge": return "Bank charge";
    case "stamp_duty": return "Stamp duty";
    case "reversal": return "Reversal";
    default: return "Payment";
  }
}

function TxnRow({ t, showDate = true }: { t: Transaction; showDate?: boolean }) {
  const credit = t.direction === "credit";
  return (
    <div className="p-txn">
      <span className={`p-txn-ico ${credit ? "in" : "out"}`} aria-hidden>{credit ? "↓" : "↑"}</span>
      <div className="p-txn-main">
        <div className="p-txn-title">{txnTitle(t)}</div>
        <div className="p-txn-sub">{t.narration}</div>
      </div>
      <div className="p-txn-amt">
        <div className={credit ? "in" : ""}>{credit ? "+" : "−"}{fmtKobo(t.amount_kobo)}</div>
        <div className="p-txn-sub">{showDate ? `${fmtDay(t.at)}, ${fmtTime(t.at)}` : fmtTime(t.at)}</div>
      </div>
    </div>
  );
}

function HistoryTab({ transactions, error }: { transactions?: Transaction[]; error?: string }) {
  const [filter, setFilter] = useState<"all" | "credit" | "debit">("all");
  if (error) return <div className="p-alert">{error}</div>;
  if (!transactions) return <p className="p-msg-meta" style={{ textAlign: "center", padding: 24 }}>Loading…</p>;

  const shown = transactions.filter((t) => filter === "all" || t.direction === filter);
  const days: [string, Transaction[]][] = [];
  for (const t of shown) {
    const label = fmtDay(t.at, true);
    if (days.at(-1)?.[0] !== label) days.push([label, []]);
    days.at(-1)![1].push(t);
  }

  return (
    <div className="stack-sm">
      <div className="p-filter" role="group" aria-label="Filter transactions">
        {([["all", "All"], ["credit", "Money in"], ["debit", "Money out"]] as const).map(([value, label]) => (
          <button key={value} type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>
      {days.map(([label, items]) => (
        <div key={label}>
          <div className="p-section" style={{ marginTop: 10 }}>{label}</div>
          <div className="p-card p-list">
            {items.map((t) => <TxnRow key={t.id} t={t} showDate={false} />)}
          </div>
        </div>
      ))}
      {!days.length && <p className="p-msg-meta" style={{ textAlign: "center", padding: 24 }}>No transactions.</p>}
    </div>
  );
}

function MoreTab({
  customer,
  accountNo,
  rewards,
  consent,
  onOpen,
}: {
  customer: Customer;
  accountNo?: string;
  rewards?: RewardsAccount;
  consent?: Consent;
  onOpen: (view: Exclude<MoreView, null>) => void;
}) {
  return (
    <div className="stack-sm">
      <div className="p-card p-list">
        <button type="button" className="p-menu" onClick={() => onOpen("rewards")}>
          <span className="p-quick-ico"><Icon name="gift" /></span>
          <span className="p-menu-label">Rewards</span>
          <span className="p-msg-meta">{rewards ? `${rewards.balance.toLocaleString("en-NG")} points` : ""}</span>
          <Icon name="chevron" size={16} />
        </button>
        <button type="button" className="p-menu" onClick={() => onOpen("privacy")}>
          <span className="p-quick-ico"><Icon name="shield" /></span>
          <span className="p-menu-label">Privacy and offers</span>
          <span className="p-msg-meta">{consent ? (consent.personalised_offers ? "On" : "Off") : ""}</span>
          <Icon name="chevron" size={16} />
        </button>
      </div>
      <div className="p-section">Profile</div>
      <div className="p-card p-list">
        <div className="row-between p-row"><span className="p-msg-meta">Name</span><span>{customer.name}</span></div>
        <div className="row-between p-row"><span className="p-msg-meta">Phone</span><span>{customer.phone}</span></div>
        <div className="row-between p-row"><span className="p-msg-meta">Account number</span><span>{accountNo ?? "…"}</span></div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Partial<Record<Message["status"], string>> = {
  scheduled: "Scheduled",
  accepted: "Accepted",
  not_now: "Not now",
};

function InboxTab({ messages, loading, error, onOpen }: { messages: Message[]; loading: boolean; error?: string; onOpen: (id: string) => void }) {
  if (loading) return <p className="p-msg-meta" style={{ textAlign: "center", padding: 24 }}>Loading…</p>;
  if (error) return <div className="p-alert">{error}</div>;
  if (!messages.length)
    return (
      <div style={{ textAlign: "center", padding: "40px 12px" }}>
        <div style={{ fontSize: 28 }} aria-hidden>✉</div>
        <div className="p-msg-title" style={{ marginTop: 8 }}>No messages</div>
        <div className="p-msg-meta">Offers and updates will appear here.</div>
      </div>
    );
  return (
    <div className="stack-sm">
      {messages.map((m) => (
        <button key={m.id} type="button" className={`p-msg ${m.status === "delivered" ? "unread" : ""}`} onClick={() => onOpen(m.id)}>
          <div className="row-between">
            <span className="p-msg-title">{m.title}</span>
            {STATUS_LABEL[m.status] && <span className="p-tag p-tag-grey">{STATUS_LABEL[m.status]}</span>}
          </div>
          <div className="p-msg-meta">
            {CHANNEL_LABEL[m.channel]} · {m.status === "scheduled" ? `arrives ${fmtTime(m.delivered_at)}` : fmtDateTime(m.delivered_at)}
          </div>
          <div className="p-msg-body">{m.body}</div>
        </button>
      ))}
    </div>
  );
}

const DONE_COPY: Record<Exclude<RespondAction, "opened">, string> = {
  accepted: "Added to your account.",
  not_now: "OK. We won't show this offer again for a while.",
  stop_offers: "Personalised offers are off on all channels. You can turn them back on in Privacy.",
};

function MessageView({ message: m, onBack, onSettings, onChanged }: { message: Message; onBack: () => void; onSettings: () => void; onChanged: () => void }) {
  const api = useApi();
  const [respond, respondState] = useAction(api.respond);
  const [loadWhy, why] = useAction(api.why);
  const [done, setDone] = useState<RespondAction | null>(null);

  // Opening the message is itself an outcome the tracker records
  useEffect(() => {
    if (m.status === "delivered") respond(m.id, "opened").then((r) => r && onChanged());
  }, [m.id]);

  const act = async (action: Exclude<RespondAction, "opened">) => {
    if (await respond(m.id, action)) {
      setDone(action);
      onChanged();
    }
  };
  const settled = m.status === "accepted" || m.status === "not_now" || done !== null;

  return (
    <>
      <div className="phone-head">
        <button type="button" className="p-link" onClick={onBack}>← Inbox</button>
      </div>
      <div className="phone-body stack-sm">
        <div className="p-card stack-sm">
          <div className="p-msg-meta">{CHANNEL_LABEL[m.channel]} · {fmtDateTime(m.delivered_at)}</div>
          <div className="p-msg-title" style={{ fontSize: 17 }}>{m.title}</div>
          <p style={{ fontSize: 14 }}>{m.body}</p>
        </div>

        <div className="p-why stack-sm">
          {why.data ? (
            <>
              <strong>Why am I seeing this?</strong>
              <span>{why.data.why}</span>
              <div className="row">
                {why.data.data_categories.map((c) => <span key={c} className="p-tag">{c}</span>)}
              </div>
              <button type="button" className="p-link" style={{ alignSelf: "flex-start" }} onClick={onSettings}>Manage what we use →</button>
            </>
          ) : (
            <button type="button" className="p-link" style={{ alignSelf: "flex-start" }} onClick={() => loadWhy(m.id)} disabled={why.loading}>
              {why.loading ? "Loading…" : "Why am I seeing this?"}
            </button>
          )}
          {why.error && <div className="p-alert">{why.error.message}</div>}
        </div>

        {done && done !== "opened" && <div className="p-ok">{DONE_COPY[done]}</div>}
        {respondState.error && <div className="p-alert">{respondState.error.message}</div>}

        {!settled && (
          <div className="stack-sm">
            <button type="button" className="p-btn p-btn-primary" disabled={respondState.loading} onClick={() => act("accepted")}>Get started</button>
            <button type="button" className="p-btn" disabled={respondState.loading} onClick={() => act("not_now")}>Not now</button>
          </div>
        )}
        {done !== "stop_offers" && (
          <button type="button" className="p-btn p-btn-danger" disabled={respondState.loading} onClick={() => act("stop_offers")}>Stop offers</button>
        )}
      </div>
    </>
  );
}

const CHANNEL_HINT: Record<Channel, string> = {
  app: "Notifications in this app",
  whatsapp: "Messages from our verified account",
  sms: "Only between 08:00 and 20:00",
  email: "To the address on your account",
  ussd: "Menus you dial from any phone",
};

function SettingsTab({ customerRef, consent, error, onSaved }: { customerRef: string; consent?: Consent; error?: string; onSaved: () => void }) {
  const api = useApi();
  const [draft, setDraft] = useState<Pick<Consent, "personalised_offers" | "channels"> | null>(null);
  const [save, saveState, resetSave] = useAction(api.setConsent);

  useEffect(() => {
    if (consent) setDraft({ personalised_offers: consent.personalised_offers, channels: { ...consent.channels } });
  }, [consent]);

  if (error) return <div className="p-alert">{error}</div>;
  if (!draft || !consent) return <p className="p-msg-meta" style={{ textAlign: "center", padding: 24 }}>Loading…</p>;

  const dirty =
    draft.personalised_offers !== consent.personalised_offers || CHANNELS.some((c) => draft.channels[c] !== consent.channels[c]);
  const update = (next: typeof draft) => {
    resetSave();
    setDraft(next);
  };

  return (
    <div className="stack-sm">
      <div className="p-section" style={{ marginTop: 4 }}>Personalised offers</div>
      <div className="p-card">
        <PhoneSwitch
          label="Use my account activity for offers"
          desc="Salary, regular payments and how your balance changes. Never health, religion, politics or betting."
          checked={draft.personalised_offers}
          onChange={(v) => update({ ...draft, personalised_offers: v })}
        />
      </div>
      <div className="p-section">Channels</div>
      <div className="p-card">
        {CONTACT_CHANNELS.map((ch) => (
          <PhoneSwitch
            key={ch}
            label={CHANNEL_LABEL[ch]}
            desc={CHANNEL_HINT[ch]}
            checked={draft.channels[ch]}
            onChange={(v) => update({ ...draft, channels: { ...draft.channels, [ch]: v } })}
          />
        ))}
      </div>
      {saveState.error && <div className="p-alert">{saveState.error.message}</div>}
      {saveState.data && !dirty && <div className="p-ok">Saved. This applies on every channel straight away.</div>}
      <button
        type="button"
        className="p-btn p-btn-primary"
        disabled={!dirty || saveState.loading}
        onClick={async () => {
          if (await save(customerRef, draft)) onSaved();
        }}
      >
        {saveState.loading ? "Saving…" : "Save changes"}
      </button>
      <div className="p-msg-meta" style={{ textAlign: "center" }}>
        Last changed {fmtDateTime(consent.updated_at)}
      </div>
    </div>
  );
}

function PhoneSwitch({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="p-switch">
      <span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        <span className="desc" style={{ display: "block" }}>{desc}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden />
    </label>
  );
}

// The API's "why" can name raw signals (salary_regular, surplus); say them in words
const SIGNAL_WORDS: Record<string, string> = {
  salary_regular: "regular salary",
  small_frequent_spend: "frequent small payments",
  surplus: "money left over each month",
  fee_season: "school fee payments",
  pos_inflow_growth: "growing POS sales",
  international_spend: "dollar payments",
  recurring_bill_pattern: "regular bill payments",
  allowance_regular: "monthly allowance",
  education_spend: "book purchases",
};

function plainWhy(why: string): string {
  const words = why.replace(/\b[a-z]+(?:_[a-z]+)+\b|\bsurplus\b/g, (w) => SIGNAL_WORDS[w] ?? w.replace(/_/g, " "));
  return /^Based on (?!your )/.test(words) ? words.replace(/^Based on /, "Based on your ") : words;
}

function ForYouTab({ customerRef, refreshKey, onPrivacy }: { customerRef: string; refreshKey: string; onPrivacy: () => void }) {
  const api = useApi();
  const productName = useProductNames();
  const forYou = useQuery(() => api.forYou(customerRef), [customerRef, refreshKey]);

  if (forYou.loading && !forYou.data) return <p className="p-msg-meta" style={{ textAlign: "center", padding: 24 }}>Loading…</p>;
  if (forYou.error) return <div className="p-alert">{forYou.error.message}</div>;
  const data = forYou.data!;

  return (
    <div className="stack-sm">
      {!data.personalised && (
        <div className="p-why">
          Popular products. <button type="button" className="p-link" onClick={onPrivacy}>Turn on personalised offers</button> to see ones that fit you.
        </div>
      )}
      {data.items.map((item) => (
        <div key={item.product_id} className="p-card stack-sm">
          <div className="p-msg-title">{productName(item.product_id, item.name)}</div>
          {item.gain && (
            <div className="p-gain">
              Could earn about <strong>{naira(item.gain.amount_ngn)}</strong> in {item.gain.period_months} months
              <div className="p-msg-meta">{item.gain.basis}</div>
            </div>
          )}
          {item.key_facts.length > 0 && (
            <div className="row" style={{ gap: 6 }}>
              {item.key_facts.map((f) => <span key={f} className="p-tag p-tag-grey">{f}</span>)}
            </div>
          )}
          {data.personalised && <div className="p-msg-meta">{plainWhy(item.why)}</div>}
        </div>
      ))}
      {data.note && <p className="p-msg-meta" style={{ textAlign: "center" }}>{data.note}</p>}
    </div>
  );
}

function RewardsTab({ customerRef, account, error, onChanged }: { customerRef: string; account?: RewardsAccount; error?: string; onChanged: () => void }) {
  const api = useApi();
  const catalogue = useQuery(() => api.rewardsCatalogue(), []);
  const [redeem, redeemState, resetRedeem] = useAction(api.redeem);
  const [redeemed, setRedeemed] = useState<string | null>(null);

  if (error) return <div className="p-alert">{error}</div>;
  if (!account) return <p className="p-msg-meta" style={{ textAlign: "center", padding: 24 }}>Loading…</p>;

  const progress = account.next_tier ? account.balance / (account.balance + account.next_tier.points_needed) : 1;

  return (
    <div className="stack-sm">
      <div className="p-balance">
        <div className="row-between">
          <span className="lbl">Points</span>
          <span className="p-tier">{account.tier}</span>
        </div>
        <div className="amt">{account.balance.toLocaleString("en-NG")}</div>
        <div className="p-progress" aria-hidden><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <div className="lbl" style={{ marginTop: 6 }}>
          {account.next_tier ? `${account.next_tier.points_needed} points to ${account.next_tier.name}` : "Top tier"}
        </div>
      </div>

      {redeemed && <div className="p-ok">Redeemed {redeemed}.</div>}
      {redeemState.error && <div className="p-alert">{redeemState.error.message}</div>}

      <div className="p-section">Redeem</div>
      {catalogue.data?.catalogue.map((r) => (
        <div key={r.id} className="p-card row-between">
          <span>
            <span className="p-msg-title" style={{ fontSize: 14 }}>{r.name}</span>
            <span className="p-msg-meta" style={{ display: "block" }}>{r.points} points</span>
          </span>
          <button
            type="button"
            className="p-btn p-btn-primary"
            style={{ width: "auto", padding: "0 14px", height: 34 }}
            disabled={account.balance < r.points || redeemState.loading}
            onClick={async () => {
              resetRedeem();
              setRedeemed(null);
              if (await redeem(customerRef, r.id)) {
                setRedeemed(r.name);
                onChanged();
              }
            }}
          >
            Redeem
          </button>
        </div>
      ))}

      <div className="p-section">Ways to earn</div>
      <div className="p-card">
        <div className="row-between p-earn"><span>Turn on personalised offers</span><span className="p-tag">50</span></div>
        <div className="row-between p-earn"><span>Give feedback on an offer</span><span className="p-tag">5</span></div>
      </div>
    </div>
  );
}

