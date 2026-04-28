import * as React from "react";
import { Text } from "react-email";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { colors, spacing } from "../components/tokens";

interface Props {
  verifyUrl: string;
}

export function VerificationEmail({ verifyUrl }: Props) {
  return (
    <Layout preview="OpenCairn 이메일 인증을 완료해 주세요">
      <Text style={{ fontSize: "16px", color: colors.text, margin: `0 0 ${spacing.md} 0` }}>
        안녕하세요,
      </Text>
      <Text style={{ fontSize: "16px", color: colors.text, margin: `0 0 ${spacing.lg} 0` }}>
        가입을 환영합니다. 아래 버튼을 눌러 이메일 주소를 인증해 주세요.
      </Text>
      <Button href={verifyUrl}>이메일 인증하기</Button>
      <Text style={{ fontSize: "13px", color: colors.textMuted, margin: `${spacing.xl} 0 0 0` }}>
        이 링크는 24시간 후 만료됩니다. 본인이 가입을 시도한 적이 없다면 이 메일은 무시하셔도 됩니다.
      </Text>
      <Text style={{ fontSize: "13px", color: colors.textMuted, margin: `${spacing.md} 0 0 0` }}>
        버튼이 동작하지 않으면 아래 주소를 브라우저에 붙여넣어 주세요:
      </Text>
      <Text style={{ fontSize: "12px", color: colors.textMuted, margin: `${spacing.xs} 0 0 0`, wordBreak: "break-all" }}>
        {verifyUrl}
      </Text>
    </Layout>
  );
}
