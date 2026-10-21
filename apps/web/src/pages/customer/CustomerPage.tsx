import { Navigate, useLocation } from "react-router";
import { ApiProvider, useSession, useTechnical } from "../../lib/context";
import { CustomerPanel } from "./CustomerPanel";
import { DemoPanel } from "./DemoPanel";
import { Phone } from "./Phone";

export function CustomerPage() {
  const { session } = useSession();
  const { technical } = useTechnical();
  const location = useLocation();
  if (!session) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;

  const customer = session.customer;
  return (
    <ApiProvider role="customer">
      <main className="container">
        <div className="page-head">
          <div>
            <h2>Hi, {customer.name.split(" ")[0]}</h2>
            <p>This is your banking app. MATCHPOINT decides if, when and how it gets in touch with you.</p>
          </div>
        </div>
        <div className="customer-layout">
          <div className="phone-col">
            <Phone customer={customer} />
          </div>
          {technical ? <DemoPanel customer={customer} /> : <CustomerPanel customer={customer} />}
        </div>
        <p className="small faint" style={{ marginTop: 32 }}>Demo only. Accounts, balances and transactions are made up.</p>
      </main>
    </ApiProvider>
  );
}
