import * as React from "react";
import { Text } from "react-email";
import { Layout } from "../components/Layout";
import { Button } from "../components/Button";
import { colors, spacing } from "../components/tokens";

interface Props {
  resetUrl: string;
}

export function ResetPasswordEmail({ resetUrl }: Props) {
  return (
    <Layout preview="OpenCairn 비밀번호 재설정 안내">
      <Text style={{ fontSize: "16px", color: colors.text, margin: `0 0 ${spacing.md} 0` }}>
        안녕하세요,
      </Text>
      <Text style={{ fontSize: "16px", color: colors.text, margin: `0 0 ${spacing.lg} 0` }}>
        비밀번호 재설정 요청을 받았습니다. 아래 버튼을 눌러 새 비밀번호를 설정해 주세요.
      </Text>
      <Button href={resetUrl}>비밀번호 재설정하기</Button>
      <Text style={{ fontSize: "13px", color: colors.textMuted, margin: `${spacing.xl} 0 0 0` }}>
        이 링크는 1시간 후 만료됩니다. 본인이 재설정을 요청하지 않았다면 이 메일은 무시하셔도 되며, 비밀번호는 변경되지 않습니다.
      </Text>
      <Text style={{ fontSize: "13px", color: colors.textMuted, margin: `${spacing.md} 0 0 0` }}>
        버튼이 동작하지 않으면 아래 주소를 브라우저에 붙여넣어 주세요:
      </Text>
      <Text style={{ fontSize: "12px", color: colors.textMuted, margin: `${spacing.xs} 0 0 0`, wordBreak: "break-all" }}>
        {resetUrl}
      </Text>
    </Layout>
  );
}
