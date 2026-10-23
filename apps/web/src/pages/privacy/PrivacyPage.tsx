import type { ReactElement } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { Section } from "../../components/Section";

function PolicySection({
    title,
    children,
}: {
    title: string;
    children: ReactElement | ReactElement[];
}) {
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
            <PageContainer width="narrow">
                <PageHeading
                    title="プライバシーポリシー"
                    description="最終更新日：2026年10月23日"
                />

                <Section className="gap-6 p-6">
                    <PolicySection title="1. はじめに">
                        <p>
                            ラム将棋（https://ramu-shogi.sh11235.com/、以下「本サービス」）は、将棋の対局・棋譜管理を提供するWebサービスです。本ポリシーは、本サービスが取得する情報とその取り扱いについて説明します。
                        </p>
                    </PolicySection>

                    <PolicySection title="2. 取得する情報">
                        <p>Googleアカウントでログインする際に以下の情報を取得します。</p>
                        <ul className="mt-2 list-inside list-disc space-y-1">
                            <li>メールアドレス</li>
                            <li>メールアドレスの確認状態</li>
                            <li>GoogleユーザーID（内部識別用）</li>
                        </ul>
                        <p className="mt-2">
                            表示名はGoogleアカウントから取得せず、ユーザーご自身に設定していただきます。プロフィール画像は取得・保存しません。
                        </p>
                        <p className="mt-2">
                            表示名は対局相手に表示され、公開した棋譜にも対局時の表示名が残ります。
                        </p>
                        <p className="mt-2">サービスの利用に伴い、次の情報も取り扱います。</p>
                        <ul className="mt-2 list-inside list-disc space-y-1">
                            <li>
                                ご自身で設定した表示名、保存・同期した設定、棋譜、研究ノート、アップロードしたNNUEファイル
                            </li>
                            <li>ログイン時のIPアドレスとブラウザ情報、ログインと利用の日時</li>
                            <li>
                                通信やアクセス解析に伴うIPアドレス、閲覧したページ、参照元、ブラウザ・端末の種類、表示速度などの情報
                            </li>
                        </ul>
                    </PolicySection>

                    <PolicySection title="3. 利用目的">
                        <p>取得した情報は以下の目的のみで利用します。</p>
                        <ul className="mt-2 list-inside list-disc space-y-1">
                            <li>ユーザー認証およびアカウント管理</li>
                            <li>
                                NNUEファイルのアップロードと棋譜の公開を、メールアドレスが確認済みのアカウントに限ること
                            </li>
                            <li>棋譜データとアカウントの紐付け</li>
                            <li>設定・研究ノート・ファイルの保存と同期</li>
                            <li>
                                第三者による不正ログインの調査、サービスへの攻撃や過剰なアクセスへの対処、障害対応
                            </li>
                            <li>利用状況と表示速度の把握・改善</li>
                        </ul>
                        <p className="mt-2">
                            メールアドレスは本人確認の目的のみで使用し、ユーザーへの連絡・マーケティングには使用しません。対戦相手など他のユーザーには公開されません。
                        </p>
                    </PolicySection>

                    <PolicySection title="4. 第三者への提供">
                        <p>
                            取得した個人情報を販売したり、広告・マーケティングのために第三者へ提供したりしません。サービスの提供に必要な認証・保存・通信・アクセス解析には、以下に記載するGoogleとCloudflareを利用し、必要な情報を送信・処理します。法令に基づく開示要求に対応する場合があります。
                        </p>
                    </PolicySection>

                    <PolicySection title="5. 情報の管理">
                        <p>
                            アカウントやサーバーに保存したデータはCloudflareのインフラ上で管理します。ログイン状態の有効期間は30日です。アカウントの削除をご希望の場合は、お問い合わせ先までご連絡ください。
                        </p>
                    </PolicySection>

                    <PolicySection title="6. Googleサービスの利用">
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
                    </PolicySection>

                    <PolicySection title="7. Cloudflareの利用とアクセス解析">
                        <p>
                            配信・データ保存・不正アクセス対策にCloudflareを利用します。アクセス解析にはCloudflare
                            Web
                            Analyticsを利用しています。この解析はCookieなどを使った利用者の追跡を行いません。詳しくは{" "}
                            <a
                                href="https://www.cloudflare.com/privacypolicy/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground underline underline-offset-2 hover:text-muted-foreground"
                            >
                                Cloudflareのプライバシーポリシー
                            </a>
                            をご参照ください。
                        </p>
                    </PolicySection>

                    <PolicySection title="8. Cookieと端末内の保存">
                        <p>
                            認証セッションの維持のためにCookieを使用します。ブラウザの設定によりCookieを無効にすることができますが、ログイン機能が使用できなくなります。
                        </p>
                        <p className="mt-2">
                            設定や研究ノートなどを端末内にも保存します。ログイン中は対応する設定やノートをサーバーへ同期します。ログアウトしても端末内の値は残るため、共有端末ではブラウザのサイトデータ削除機能をご利用ください。端末内だけにある未同期データも削除されます。
                        </p>
                    </PolicySection>

                    <PolicySection title="9. お問い合わせ">
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
                    </PolicySection>

                    <PolicySection title="10. ポリシーの変更">
                        <p>
                            必要に応じて本ポリシーを改定することがあります。重要な変更がある場合はサービス上でお知らせします。
                        </p>
                    </PolicySection>
                </Section>
            </PageContainer>
        </>
    );
}
