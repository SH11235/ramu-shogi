import type { ReactElement } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";

function Section({ title, children }: { title: string; children: ReactElement | ReactElement[] }) {
    return (
        <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
        </section>
    );
}

export default function PrivacyPage(): ReactElement {
    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "プライバシーポリシー" }]}
                right={<HeaderNav />}
            />
            <main className="mx-auto flex max-w-[720px] flex-col gap-8 px-4 py-8">
                <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-bold text-foreground">プライバシーポリシー</h1>
                    <p className="text-sm text-muted-foreground">最終更新日：2026年3月15日</p>
                </div>

                <div className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6 shadow-sm">
                    <Section title="1. はじめに">
                        <p>
                            ラム将棋（https://ramu-shogi.sh11235.com/、以下「本サービス」）は、将棋の対局・棋譜管理を提供するWebサービスです。本ポリシーは、本サービスが取得する情報とその取り扱いについて説明します。
                        </p>
                    </Section>

                    <Section title="2. 取得する情報">
                        <p>Googleアカウントでログインする際に以下の情報を取得します。</p>
                        <ul className="mt-2 list-inside list-disc space-y-1">
                            <li>メールアドレス</li>
                            <li>GoogleユーザーID（内部識別用）</li>
                        </ul>
                        <p className="mt-2">
                            表示名はGoogleアカウントから取得せず、ユーザーご自身に設定していただきます。プロフィール画像は取得・保存しません。
                        </p>
                    </Section>

                    <Section title="3. 利用目的">
                        <p>取得した情報は以下の目的のみで利用します。</p>
                        <ul className="mt-2 list-inside list-disc space-y-1">
                            <li>ユーザー認証およびアカウント管理</li>
                            <li>NNUEファイルアップロードおよび棋譜公開時の不正利用防止</li>
                            <li>棋譜データとアカウントの紐付け</li>
                        </ul>
                        <p className="mt-2">
                            メールアドレスは本人確認の目的のみで使用し、ユーザーへの連絡・マーケティングには使用しません。対戦相手など他のユーザーには公開されません。
                        </p>
                    </Section>

                    <Section title="4. 第三者への提供">
                        <p>
                            取得した個人情報を第三者に販売・提供・開示することはありません。ただし、法令に基づく開示要求がある場合はこの限りではありません。
                        </p>
                    </Section>

                    <Section title="5. 情報の管理">
                        <p>
                            取得した情報はCloudflareのインフラ上で管理します。アカウントの削除をご希望の場合は、お問い合わせ先までご連絡ください。
                        </p>
                    </Section>

                    <Section title="6. Googleサービスの利用">
                        <p>
                            本サービスは認証にGoogle
                            OAuthを利用しています。Googleのプライバシーポリシーについては{" "}
                            <a
                                href="https://policies.google.com/privacy"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground underline underline-offset-2 hover:text-muted-foreground"
                            >
                                Google のプライバシーポリシー
                            </a>
                            をご参照ください。
                        </p>
                    </Section>

                    <Section title="7. Cookieの利用">
                        <p>
                            認証セッションの維持のためにCookieを使用します。ブラウザの設定によりCookieを無効にすることができますが、ログイン機能が使用できなくなります。
                        </p>
                    </Section>

                    <Section title="8. お問い合わせ">
                        <p>
                            プライバシーポリシーに関するご質問は、X（旧Twitter）アカウント{" "}
                            <a
                                href="https://x.com/ramu_shogi"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground underline underline-offset-2 hover:text-muted-foreground"
                            >
                                @ramu_shogi
                            </a>
                            までご連絡ください。
                        </p>
                    </Section>

                    <Section title="9. ポリシーの変更">
                        <p>
                            必要に応じて本ポリシーを改定することがあります。重要な変更がある場合はサービス上でお知らせします。
                        </p>
                    </Section>
                </div>
            </main>
        </>
    );
}
