import { InviteEmail } from "../src/templates/invite";

// react-email CLI renders this default export in the preview server.
// Props here are hard-coded fixtures — production data is injected by apps/api at send time.
export default function Preview() {
  return (
    <InviteEmail
      inviter="김개발"
      signupUrl="https://opencairn.com/ko/auth/signup?invite=example-token"
    />
  );
}

Preview.PreviewProps = {
  inviter: "김개발",
  signupUrl: "https://opencairn.com/ko/auth/signup?invite=example-token",
};
