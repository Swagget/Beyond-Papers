import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Paginated, PublicUser, WorkSummary } from '@shared/types';
import { api, ApiRequestError } from '../api';
import WorkCard from '../components/WorkCard';

const PAGE_SIZE = 20;
type TabKey = 'works' | 'reviews';

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();

  const [user, setUser] = useState<PublicUser | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [userError, setUserError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>('works');

  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [worksTotal, setWorksTotal] = useState(0);
  const [worksLoading, setWorksLoading] = useState(true);
  const [worksError, setWorksError] = useState<string | null>(null);

  const [reviews, setReviews] = useState<WorkSummary[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);

  useEffect(() => {
    if (!id) return;
    setUserLoading(true);
    setUserError(null);
    api
      .get<{ user: PublicUser }>(`/api/users/${id}`)
      .then((res) => setUser(res.user))
      .catch((err) => setUserError(err instanceof ApiRequestError ? err.message : 'Failed to load profile.'))
      .finally(() => setUserLoading(false));
  }, [id]);

  const loadWorks = (offset: number) => {
    if (!id) return;
    setWorksLoading(true);
    setWorksError(null);
    api
      .get<Paginated<WorkSummary>>(`/api/users/${id}/works?limit=${PAGE_SIZE}&offset=${offset}`)
      .then((res) => {
        setWorks((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
        setWorksTotal(res.total);
      })
      .catch((err) => setWorksError(err instanceof ApiRequestError ? err.message : 'Failed to load works.'))
      .finally(() => setWorksLoading(false));
  };

  useEffect(() => {
    setWorks([]);
    setWorksTotal(0);
    setReviews([]);
    setReviewsTotal(0);
    setReviewsLoaded(false);
    setTab('works');
    if (id) loadWorks(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadReviews = (offset: number) => {
    if (!id) return;
    setReviewsLoading(true);
    setReviewsError(null);
    api
      .get<Paginated<WorkSummary>>(`/api/users/${id}/reviews?limit=${PAGE_SIZE}&offset=${offset}`)
      .then((res) => {
        setReviews((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
        setReviewsTotal(res.total);
        setReviewsLoaded(true);
      })
      .catch((err) => setReviewsError(err instanceof ApiRequestError ? err.message : 'Failed to load reviews.'))
      .finally(() => setReviewsLoading(false));
  };

  const selectTab = (key: TabKey) => {
    setTab(key);
    if (key === 'reviews' && !reviewsLoaded && !reviewsLoading) loadReviews(0);
  };

  if (userLoading) {
    return (
      <div className="stack">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      </div>
    );
  }

  if (userError || !user) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Profile not found</p>
        <p className="empty-state-body">{userError ?? 'This user does not exist.'}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="stack gap-2">
        <div className="row items-center gap-2 flex-wrap">
          <h1>{user.display_name}</h1>
          {user.is_pseudonym ? <span className="badge">pseudonymous</span> : null}
        </div>
        {user.orcid ? (
          <p className="small">
            ORCID:{' '}
            <a href={`https://orcid.org/${user.orcid}`} target="_blank" rel="noreferrer">
              {user.orcid}
            </a>
          </p>
        ) : null}
        {user.bio ? <p>{user.bio}</p> : null}
        <p className="muted small">Member since {user.created_at.slice(0, 10)}</p>
      </header>

      <div className="tabs" role="tablist" aria-label="Profile sections">
        <button
          className={`tab ${tab === 'works' ? 'tab-active' : ''}`}
          role="tab"
          aria-selected={tab === 'works'}
          onClick={() => selectTab('works')}
        >
          Works{worksTotal ? ` (${worksTotal})` : ''}
        </button>
        <button
          className={`tab ${tab === 'reviews' ? 'tab-active' : ''}`}
          role="tab"
          aria-selected={tab === 'reviews'}
          onClick={() => selectTab('reviews')}
        >
          Reviews{reviewsTotal ? ` (${reviewsTotal})` : ''}
        </button>
      </div>

      {tab === 'works' ? (
        <div className="stack" role="tabpanel" aria-label="Works">
          {worksError ? (
            <p className="small" role="alert" style={{ color: 'var(--color-danger)' }}>
              {worksError}
            </p>
          ) : null}
          {worksLoading && works.length === 0 ? (
            <div className="stack">
              <div className="skeleton skeleton-text" />
              <div className="skeleton skeleton-text" />
              <div className="skeleton skeleton-text" style={{ width: '70%' }} />
            </div>
          ) : works.length === 0 && !worksError ? (
            <div className="empty-state">
              <p className="empty-state-title">No works yet</p>
              <p className="empty-state-body">
                Works where {user.display_name} is an author will appear here — negative and null
                results included, since they're visible career credit (§6.3/§1.4).
              </p>
            </div>
          ) : (
            <>
              <div className="stack">
                {works.map((w) => (
                  <WorkCard key={w.id} work={w} />
                ))}
              </div>
              {works.length < worksTotal ? (
                <button className="btn btn-ghost" onClick={() => loadWorks(works.length)} disabled={worksLoading}>
                  {worksLoading ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="stack" role="tabpanel" aria-label="Reviews">
          <p className="small muted">Reviews are citable contributions (§5.1).</p>
          {reviewsError ? (
            <p className="small" role="alert" style={{ color: 'var(--color-danger)' }}>
              {reviewsError}
            </p>
          ) : null}
          {reviewsLoading && reviews.length === 0 ? (
            <div className="stack">
              <div className="skeleton skeleton-text" />
              <div className="skeleton skeleton-text" />
            </div>
          ) : reviews.length === 0 && !reviewsError && reviewsLoaded ? (
            <div className="empty-state">
              <p className="empty-state-title">No reviews yet</p>
            </div>
          ) : (
            <>
              <div className="stack">
                {reviews.map((w) => (
                  <WorkCard key={w.id} work={w} />
                ))}
              </div>
              {reviews.length < reviewsTotal ? (
                <button
                  className="btn btn-ghost"
                  onClick={() => loadReviews(reviews.length)}
                  disabled={reviewsLoading}
                >
                  {reviewsLoading ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
