import { Navigate, useLocation } from "react-router";
import { ApiProvider, useSession, useTechnical } from "../../lib/context";
import { CustomerPanel, SandboxBar } from "./CustomerPanel";
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
      <SandboxBar customerRef={customer.customer_ref} />
      <main className="container">
        <div className="customer-layout">
          <div className="phone-col">
            <Phone customer={customer} />
          </div>
          {technical ? <DemoPanel customer={customer} /> : <CustomerPanel customer={customer} />}
        </div>
      </main>
    </ApiProvider>
  );
}
