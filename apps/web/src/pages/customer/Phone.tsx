import { useEffect, useState } from "react";
import { useApi } from "../../lib/context";
import { CHANNEL_LABEL, fmtDateTime, fmtTime } from "../../lib/format";
import { useAction, useQuery, useStream } from "../../lib/hooks";
import { useProductNames } from "../../lib/products";
import { CHANNELS, CONTACT_CHANNELS, type Channel, type Consent, type Customer, type Message, type RespondAction, type RewardsAccount } from "../../lib/types";

type Tab = "home" | "foryou" | "inbox" | "rewards" | "settings";

/** The customer's phone: every endpoint in api_design.md 5.2. */
export function Phone({ customer }: { customer: Customer }) {
  const api = useApi();
  const ref = customer.customer_ref;
  const [tab, setTab] = useState<Tab>("inbox");
  const [openId, setOpenId] = useState<string | null>(null);

  const inbox = useQuery(() => api.inbox(ref), [ref]);
  const profile = useQuery(() => api.customer(ref), [ref]);
  const consent = useQuery(() => api.consent(ref), [ref]);
  const rewards = useQuery(() => api.rewards(ref), [ref]);

  // The API doesn't announce every customer action on the stream, so refresh after our own
  const refreshAll = () => {
    inbox.reload();
    profile.reload();
    consent.reload();
    rewards.reload();
  };

  useStream((e) => {
    if (e.data.customer_ref !== ref) return;
    if (e.type === "message_delivered" || e.type === "outcome_recorded") {
      inbox.reload();
      profile.reload();
    }
    if (e.type === "consent_changed") consent.reload();
    if (e.type === "points_awarded" || e.type === "points_redeemed" || e.type === "tier_changed") rewards.reload();
  });

  const messages = inbox.data?.items ?? [];
  const unread = messages.filter((m) => m.status === "delivered").length;
  const open = messages.find((m) => m.id === openId);

  return (
    <div className="phone" aria-label="Customer phone view">
      <div className="phone-screen">
        <div className="phone-notch" aria-hidden />
        <div className="phone-status">
          <span>9:41</span>
          <span>●●● 5G</span>
        </div>

        {open ? (
          <MessageView message={open} onBack={() => setOpenId(null)} onSettings={() => { setOpenId(null); setTab("settings"); }} onChanged={refreshAll} />
        ) : (
          <>
            <div className="phone-head">
              <div className="muted small">Good morning,</div>
              <h2>{customer.name.split(" ")[0]}</h2>
            </div>
            <div className="phone-body">
              {tab === "home" && <HomeTab holdings={profile.data?.holdings ?? customer.holdings} unread={unread} onInbox={() => setTab("inbox")} />}
              {tab === "inbox" && <InboxTab messages={messages} loading={inbox.loading && !inbox.data} error={inbox.error?.message} onOpen={setOpenId} />}
              {tab === "foryou" && <ForYouTab customerRef={ref} refreshKey={`${consent.data?.personalised_offers}|${profile.data?.holdings.length}`} onPrivacy={() => setTab("settings")} />}
              {tab === "rewards" && <RewardsTab customerRef={ref} account={rewards.data} error={rewards.error?.message} onChanged={rewards.reload} />}
              {tab === "settings" && <SettingsTab customerRef={ref} consent={consent.data} error={consent.error?.message} onSaved={refreshAll} />}
            </div>
          </>
        )}

        <nav className="phone-tabs">
          {([
            ["home", "⌂", "Home"],
            ["foryou", "★", "For you"],
            ["inbox", "✉", unread ? `Inbox (${unread})` : "Inbox"],
            ["rewards", "◆", "Rewards"],
            ["settings", "⚙", "Privacy"],
          ] as const).map(([value, icon, label]) => (
            <button key={value} type="button" className={tab === value && !open ? "active" : ""} onClick={() => { setOpenId(null); setTab(value); }}>
              <span className="ico" aria-hidden>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function HomeTab({ holdings, unread, onInbox }: { holdings: string[]; unread: number; onInbox: () => void }) {
  const productName = useProductNames();
  return (
    <div className="stack-sm">
      <div className="p-balance">
        <div className="lbl">Available balance</div>
        <div className="amt">₦ 482,150.00</div>
      </div>
      {unread > 0 && (
        <button type="button" className="p-msg unread" onClick={onInbox}>
          <div className="p-msg-title">You have {unread} new message{unread > 1 ? "s" : ""}</div>
          <div className="p-msg-meta">Tap to read</div>
        </button>
      )}
      <div className="p-section">Your products</div>
      {holdings.map((h) => (
        <div key={h} className="p-card row-between">
          <span>{productName(h)}</span>
          <span className="p-tag">Active</span>
        </div>
      ))}
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
};

function plainWhy(why: string): string {
  const words = why.replace(/\b[a-z]+(?:_[a-z]+)+\b|\bsurplus\b/g, (w) => SIGNAL_WORDS[w] ?? w.replace(/_/g, " "));
  return /^Based on (?!your )/.test(words) ? words.replace(/^Based on /, "Based on your ") : words;
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

function ForYouTab({ customerRef, refreshKey, onPrivacy }: { customerRef: string; refreshKey: string; onPrivacy: () => void }) {
  const api = useApi();
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
          <div className="p-msg-title">{item.name}</div>
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

