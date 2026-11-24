import { redirect } from "next/navigation";

export default function LegacyAddressBookRedirectPage() {
  redirect("/account?tab=addresses");
}
