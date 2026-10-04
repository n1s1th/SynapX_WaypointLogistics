import { IssueView } from "./issue-view";

// L8 · Waiting on the Dispatcher / decision (Figma 3a, 3b, 3c and T3a, T3b, T3c).
export default async function LoaderIssuePage(props: PageProps<"/loader/issues/[id]">) {
  const { id } = await props.params;
  return <IssueView id={Number(id)} />;
}
