<script>
  import { onMount } from 'svelte';
  import Admin from './routes/Admin.svelte';
  import Staff from './routes/Staff.svelte';
  import Session from './routes/Session.svelte';
  import { getClerk, isClerkLoaded } from './lib/clerk';

  let clerk;
  let currentPath = window.location.pathname;
  let isAuthenticated = false;
  let isAdmin = false;

  function navigate(path) {
    window.history.pushState({}, '', path);
    currentPath = path;
  }

  function handlePopState() {
    currentPath = window.location.pathname;
  }

  onMount(async () => {
    window.addEventListener('popstate', handlePopState);

    try {
      clerk = await getClerk();
      
      // Check if user is authenticated
      if (clerk.user) {
        isAuthenticated = true;
        
        // Check organization membership
        if (clerk.user.organizationMemberships.length === 0) {
          alert("You are not authorized");
          await clerk.signOut();
          navigate('/');
          return;
        }

        // Check if user is admin
        isAdmin = clerk.user.organizationMemberships.some(x => x.role === "org:admin");
        
        // Only redirect if not already on the correct page and not on session page
        if (currentPath !== '/session') {
          if (isAdmin && currentPath !== '/admin') {
            navigate('/admin');
          } else if (!isAdmin && currentPath !== '/staff') {
            navigate('/staff');
          }
        }
      } else {
        // No user, show sign in
        if (currentPath !== '/') {
          navigate('/');
        }
        clerk.openSignIn();
      }
    } catch (error) {
      console.error('Error initializing Clerk:', error);
      if (currentPath !== '/') {
        navigate('/');
      }
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  });

  function handleBackToHome() {
    navigate('/');
  }
</script>

<main>
  {#if currentPath === '/admin' && isAdmin}
    <Admin />
  {:else if currentPath === '/staff' && !isAdmin}
    <Staff />
  {:else if currentPath === '/session' && isAuthenticated}
    <Session />
  {:else}
    <div class="login-container">
      <div class="login-box">
        <h2>Staff Login</h2>
        {#if isClerkLoaded()}
          <div class="auth-container">
            <div class="auth-tabs">
              <button class="tab-button active"
              on:click={()=>clerk.openSignIn()}
              >
                Sign In
              </button>
              <button class="tab-button"
              on:click={()=>clerk.openSignUp()}
              >
                Sign Up
              </button>
            </div>
            <div id="sign-in"></div>
            <div id="sign-up"></div>
          </div>
        {:else}
          <div class="loading">Loading authentication...</div>
        {/if}
        <button class="back-button" on:click={handleBackToHome}>Back to Home</button>
      </div>
    </div>
  {/if}
</main>

<style>
  .login-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background-color: #f5f5f5;
    padding: 20px;
  }

  .login-box {
    background-color: white;
    padding: 2rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    width: 100%;
    max-width: 400px;
  }

  h2 {
    color: #2196F3;
    text-align: center;
    margin-bottom: 2rem;
    font-size: 1.8rem;
  }

  .auth-container {
    margin-bottom: 1.5rem;
  }

  .auth-tabs {
    display: flex;
    margin-bottom: 1rem;
    border-bottom: 1px solid #ddd;
  }

  .tab-button {
    flex: 1;
    padding: 0.8rem;
    background: none;
    border: none;
    color: #666;
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab-button.active {
    color: #2196F3;
    border-bottom: 2px solid #2196F3;
  }

  .tab-button:hover {
    color: #2196F3;
  }

  .loading {
    text-align: center;
    color: #666;
    padding: 2rem;
  }

  .back-button {
    width: 100%;
    padding: 0.8rem;
    background-color: #666;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 1rem;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .back-button:hover {
    background-color: #555;
  }
</style> 