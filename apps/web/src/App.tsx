import { Navigate, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { Campaigns, Products } from "./pages/console/Catalogue";
import { ConsolePage } from "./pages/console/ConsolePage";
import { ReviewQueue, RunDecisions, SilenceFeed } from "./pages/console/Decisions";
import { Audit, Events, Simulator } from "./pages/console/DemoControl";
import { Experiments, Model } from "./pages/console/Evidence";
import { Overview } from "./pages/console/Overview";
import { Policies } from "./pages/console/Policies";
import { CustomerPage } from "./pages/customer/CustomerPage";
import { Home } from "./pages/Home";
import { SignIn } from "./pages/SignIn";
import { SignUp } from "./pages/SignUp";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="signin" element={<SignIn />} />
        <Route path="signup" element={<SignUp />} />
        <Route path="app" element={<CustomerPage />} />
        <Route path="console" element={<ConsolePage />}>
          <Route index element={<Overview />} />
          <Route path="decisions" element={<SilenceFeed />} />
          <Route path="review" element={<ReviewQueue />} />
          <Route path="run" element={<RunDecisions />} />
          <Route path="policies" element={<Policies />} />
          <Route path="products" element={<Products />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="experiments" element={<Experiments />} />
          <Route path="model" element={<Model />} />
          <Route path="simulator" element={<Simulator />} />
          <Route path="events" element={<Events />} />
          <Route path="audit" element={<Audit />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
