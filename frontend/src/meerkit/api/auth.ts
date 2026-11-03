import type {
  EmailCodeInput,
  ForgotIdInput,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
  SignupInput,
  TokenResponse,
  User,
  VerifyEmailCodeInput,
  VerifyEmailCodeResponse,
} from "../types";
import { meerkitConfig } from "../config";
import { api } from "./client";

export const authApi = {
  signup: (input: SignupInput) =>
    api.post<User>("/auth/signup", input).then((r) => r.data),
  // 구글 로그인은 서버가 인증을 시작한다. 브라우저를 이 주소로 보내면 구글 → 서버 → /auth/google/callback 순서로 돌아온다
  googleLoginUrl: () => `${meerkitConfig.apiBaseUrl}/auth/google/login`,
  login: (input: LoginInput) =>
    api.post<TokenResponse>("/auth/login", input).then((r) => r.data),
  logout: () => api.post("/auth/logout"),
  me: () => api.get<User>("/users/me").then((r) => r.data),
  // 아이디를 쓸 수 있는지(중복·예약어). 형식이 틀리면 서버가 422를 준다
  checkUserId: (userId: string) =>
    api
      .get<{
        available: boolean;
      }>("/auth/check-user-id", { params: { user_id: userId } })
      .then((r) => r.data.available),
  // 가입된 이메일인지 알려 주지 않도록, 서버는 항상 같은 응답을 준다.
  // 아이디 찾기: 가입된 이메일이면 일부를 가린 아이디를 메일로 보낸다. 가입 여부와 관계없이 항상 같은 응답 (서버 구현 필요)
  forgotId: (input: ForgotIdInput) => api.post("/auth/id/forgot", input),
  forgotPassword: (input: ForgotPasswordInput) =>
    api.post("/auth/password/forgot", input),
  resetPassword: (input: ResetPasswordInput) =>
    api.post("/auth/password/reset", input),
  // 이메일 인증번호 발송 / 확인. 확인에 성공하면 가입 요청에 붙일 증표(token)를 돌려준다.
  sendEmailCode: (input: EmailCodeInput) =>
    api.post("/auth/email/send-code", input),
  verifyEmailCode: (input: VerifyEmailCodeInput) =>
    api
      .post<VerifyEmailCodeResponse>("/auth/email/verify-code", input)
      .then((r) => r.data),
};
