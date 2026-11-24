import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../lib/server';
import Mark, { Wordmark } from '../components/Mark';

export const dynamic = 'force-dynamic';

// The front page: what Cairn is, before anyone is asked to sign in.
// People who are already signed in go straight on to their vault.
export default async function Landing() {
  if (await currentUser()) redirect('/home');

  return (
    <div className="landing">
      <header className="landing-bar">
        <Wordmark size={32} />
        <nav aria-label="Account">
          <Link href="/signin" className="button ghost">Sign in</Link>
          <Link href="/signin?mode=signup" className="button primary small">Get started</Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-text">
          <h1>A calm place to leave things in order.</h1>
          <p>
            Cairn keeps a record of the everyday accounts your household relies on, such as streaming services,
            the home Wi-Fi and the garage door code, with a note and a wish for each. When the time comes, the
            person you trust is guided through them, one at a time.
          </p>
          <div className="actions">
            <Link href="/signin?mode=signup" className="button primary">Get started</Link>
            <Link href="/signin" className="button secondary on-dark">Sign in</Link>
          </div>
        </div>

        <figure className="hero-card" aria-label="An example of what an executor sees">
          <p className="hero-card-meta">Service 3 of 12</p>
          <p className="hero-card-title">Netflix</p>
          <p className="hero-card-wish">Robert&apos;s wish: <strong>Close it</strong></p>
          <div className="notebox">
            <span className="label">A note left for you</span>
            <p>This is on the family plan. Cancel it last, after the kids have moved their profiles.</p>
          </div>
          <ol className="steps">
            <li>Open Netflix&apos;s request form for a deceased member&apos;s account.</li>
            <li>Attach the death certificate and submit it.</li>
          </ol>
          <figcaption>An example of what your executor sees</figcaption>
        </figure>
      </section>

      <main>
        <section className="band" aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <ol className="how">
            <li>
              <span className="how-num">1</span>
              <h3>Write things down</h3>
              <p>Add the services you use, the login for each, a note in your own words, and whether it should be kept, transferred or closed.</p>
            </li>
            <li>
              <span className="how-num">2</span>
              <h3>Choose your executor</h3>
              <p>Invite the person you trust. Give them your recovery key, on paper or in person. We never send it by email.</p>
            </li>
            <li>
              <span className="how-num">3</span>
              <h3>They are guided through it</h3>
              <p>When the time comes, they open the vault and work through one service at a time, with clear, current steps.</p>
            </li>
          </ol>
        </section>

        <section className="band two-col" aria-labelledby="privacy">
          <div>
            <h2 id="privacy">We cannot read your vault</h2>
            <p className="lead">Everything you add is locked on your own device before it is saved. What reaches us is scrambled text that only your passphrase or your recovery key can open.</p>
            <p className="quiet">That also means we cannot reset it. If both the passphrase and the recovery key are lost, nobody can open the vault, including us.</p>
          </div>
          <div className="card">
            <h3>What we can see</h3>
            <ul className="ticks">
              <li>Your email address and first name</li>
              <li>When things were saved</li>
            </ul>
            <h3>What we cannot see</h3>
            <ul className="ticks no">
              <li>Which services you use</li>
              <li>Usernames, passwords and codes</li>
              <li>Your notes and steps</li>
            </ul>
          </div>
        </section>

        <section className="band two-col" aria-labelledby="fit">
          <div>
            <h2 id="fit">What belongs here</h2>
            <p>Streaming and music, email and photo accounts, the home router, alarm and garage door codes, phone and utility accounts: the everyday things that are hard to sort out without the right details.</p>
          </div>
          <div className="note warn">
            <p style={{ margin: 0 }}><strong>Not for money.</strong> Please keep bank logins, investments and crypto wallets with your will or a financial adviser instead. Cairn is deliberately not built for them.</p>
          </div>
        </section>

        <section className="band executor-band" aria-labelledby="exec">
          <Mark size={44} />
          <div>
            <h2 id="exec">Were you asked to be someone&apos;s executor?</h2>
            <p>Create a free account with the email address your invitation was sent to. There is nothing else to do for now. Keep the recovery key you were given somewhere safe.</p>
            <Link href="/signin?mode=signup" className="button secondary">Create my account</Link>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <Wordmark size={24} />
        <p>
          Cairn protects your details if our servers are ever broken into. It cannot protect against a lost or stolen
          recovery key, or an unlocked device left with someone else, so please keep both safe.
        </p>
      </footer>
    </div>
  );
}
