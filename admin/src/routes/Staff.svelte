<script>
  import { onMount } from "svelte";
  import { getClerk } from '../lib/clerk';

  let message = '';
  let staffId = null;
  let sessions = [];
  let loading = false;
  let error = null;
  let selectedSession = null;
  let messages = [];
  let messageLoading = false;
  let messageError = null;
  let newMessage = '';
  let clerk;

  function navigate(path) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  onMount(async () => {
    try {
      clerk = await getClerk();

      // Check if user is authenticated
      if (!clerk.user) {
        navigate('/');
        return;
      }

      // Check if user is admin
      const isAdmin = clerk.user.organizationMemberships.some(x => x.role === "org:admin");
      if (isAdmin) {
        navigate('/admin');
        return;
      }
    } catch (error) {
      console.error('Error initializing Clerk:', error);
      navigate('/');
    }
  });

  async function handleSignOut() {
    try {
      if (clerk) {
        await clerk.signOut();
        navigate('/');
      }
    } catch (error) {
      console.error('Error signing out:', error);
      error = 'Failed to sign out';
    }
  }

  function handleSession() {
    if (clerk?.user) {
      navigate('/session');
    } else {
      navigate('/');
    }
  }
</script>

<main>
  <div class="staff-container">
    <div class="header">
      <h1>Staff Dashboard</h1>
      <div class="header-buttons">
        <button class="session-button" on:click={handleSession}>Sessions</button>
        <button class="sign-out-button" on:click={handleSignOut}>Sign Out</button>
      </div>
    </div>
    <div class="content">
      <h2>This is staff</h2>
    </div>
  </div>
</main>

<style>
  .staff-container {
    padding: 2rem;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .header-buttons {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  h1 {
    color: #333;
    margin: 0;
    font-size: 2rem;
  }

  .session-button {
    background-color: #007bff;
    color: white;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    transition: background-color 0.2s;
  }

  .session-button:hover {
    background-color: #0056b3;
  }

  .sign-out-button {
    background-color: #dc3545;
    color: white;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    transition: background-color 0.2s;
  }

  .sign-out-button:hover {
    background-color: #c82333;
  }

  .content {
    background: white;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  h2 {
    color: #666;
    margin: 0;
    font-size: 1.5rem;
  }
</style>