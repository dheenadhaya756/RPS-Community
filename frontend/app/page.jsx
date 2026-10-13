import HomeClient from "./HomeClient";
import { loadPublicWorkshops } from "@/lib/community/publicWorkshops";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { workshops, error } = await loadPublicWorkshops();
  return <HomeClient workshops={workshops} loadError={error} />;
}
