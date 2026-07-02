import LoginForm from './login-form';

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

function normalizeRedirectPath(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }

  return value;
}

export default async function LoginPage({ searchParams }: LoginPageProps): Promise<JSX.Element> {
  const params = await searchParams;

  return <LoginForm redirectTo={normalizeRedirectPath(params.next)} />;
}