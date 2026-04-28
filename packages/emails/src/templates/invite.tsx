import * as React from "react";
import { Text } from "react-email";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { colors, spacing } from "../components/tokens";

interface Props {
  inviter: string;
  signupUrl: string;
}

export function InviteEmail({ inviter, signupUrl }: Props) {
  return (
    <Layout preview={`${inviter}님이 OpenCairn 워크스페이스에 초대하셨습니다`}>
      <Text style={{ fontSize: "16px", color: colors.text, margin: `0 0 ${spacing.md} 0` }}>
        안녕하세요,
      </Text>
      <Text style={{ fontSize: "16px", color: colors.text, margin: `0 0 ${spacing.lg} 0` }}>
        <strong>{inviter}</strong>님이 OpenCairn 워크스페이스에 함께 작업하자고 초대하셨습니다.
      </Text>
      <Button href={signupUrl}>초대 수락하기</Button>
      <Text style={{ fontSize: "13px", color: colors.textMuted, margin: `${spacing.xl} 0 0 0` }}>
        버튼이 동작하지 않으면 아래 주소를 브라우저에 붙여넣어 주세요:
      </Text>
      <Text style={{ fontSize: "12px", color: colors.textMuted, margin: `${spacing.xs} 0 0 0`, wordBreak: "break-all" }}>
        {signupUrl}
      </Text>
    </Layout>
  );
}
