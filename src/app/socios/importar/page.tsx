import ImportSocios from "../../../components/ImportSocios";
import Shell from "../../../components/Shell";
import { requireAdmin } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export default async function ImportarSociosPage() {
  const user = await requireAdmin();
  return (
    <Shell user={user}>
      <ImportSocios />
    </Shell>
  );
}
