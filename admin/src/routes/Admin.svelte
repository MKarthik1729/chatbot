<script>
  import { Clerk } from "@clerk/clerk-js";
  import { onMount } from "svelte";
  import { createClient } from '@supabase/supabase-js';

  let clerk;
  let clerkLoaded = false;
  let organizationMembers = [];
  let loading = true;
  let error = null;
  let messages = [];
  
  // Selection state
  let selectedGuest = null;
  let selectedMember = null;

  // Initialize Supabase client
  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );

  onMount(async () => {
    try {
      clerk = new Clerk(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
      await clerk.load();
      clerkLoaded = true;

      // Get the current organization
      const organization = await clerk.organization;
      
      if (organization) {
        // Get all members of the organization
        const members = await organization.getMemberships();
        organizationMembers = members.data || [];
        console.log('Organization Members:', members);

        // Fetch messages using Supabase RPC with organization ID
        const { data: messagesData, error: messagesError } = await supabase
          .rpc('get_messages_query', { p_to: organization.id });

        if (messagesError) {
          console.error('Error fetching messages:', messagesError);
        } else {
          messages = messagesData || [];
          console.log('Messages from RPC:', messagesData);
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
      error = 'Failed to load data';
    } finally {
      loading = false;
    }
  });

  async function handleSignOut() {
    try {
      await clerk.signOut();
      window.location.href = '/';
    } catch (error) {
      console.error('Error signing out:', error);
      error = 'Failed to sign out';
    }
  }

  function handleGuestSelect(guestId) {
    selectedGuest = selectedGuest === guestId ? null : guestId;
  }

  function handleMemberSelect(member) {
    selectedMember = selectedMember?.id === member.id ? null : member;
  }

  async function handleAssign(member) {
    if (selectedGuest && member && clerk.organization) {
      try {
        // Insert new session record
        const { data, error: insertError } = await supabase
          .from('session')
          .insert({
            user_id: selectedGuest,
            staff_id: member.publicUserData.userId,
            status: 'pending',
            organisation_id: clerk.organization.id
          });

        if (insertError) {
          console.error('Error creating session:', insertError);
          error = 'Failed to create session';
          return;
        }

        console.log('Session created:', data);
        
        // Re-fetch messages to update the list
        const { data: messagesData, error: messagesError } = await supabase
          .rpc('get_messages_query', { p_to: clerk.organization.id });

        if (messagesError) {
          console.error('Error re-fetching messages:', messagesError);
        } else {
          messages = messagesData || [];
        }
        
        // Reset selections after successful insert
        selectedGuest = null;
        selectedMember = null;
      } catch (err) {
        console.error('Error in assignment:', err);
        error = 'Failed to process assignment';
      }
    }
  }
</script>

<main>
  <div class="admin-container">
    <div class="header">
      <h1>Admin Dashboard</h1>
      <div class="header-buttons">
        <button class="session-button" on:click={() => window.location.href = '/session'}>Session</button>
        <button class="sign-out-button" on:click={handleSignOut}>Sign Out</button>
      </div>
    </div>
    
    <div class="dashboard-layout">
      <!-- User Requests Section -->
      <div class="section-container">
        <h2>User Requests</h2>
        <div class="scrollable-content">
          {#if loading}
            <div class="loading">Loading requests...</div>
          {:else if error}
            <div class="error">{error}</div>
          {:else}
            <div class="guest-list">
              {#each messages as guestId}
                <div 
                  class="guest-item {selectedGuest === guestId ? 'selected' : ''}"
                  on:click={() => handleGuestSelect(guestId)}
                >
                  {guestId}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- Members Section -->
      <div class="section-container">
        <h2>Organization Members</h2>
        <div class="scrollable-content">
          {#if loading}
            <div class="loading">Loading members...</div>
          {:else if error}
            <div class="error">{error}</div>
          {:else}
            <div class="members-grid">
              {#each organizationMembers as member}
                <div 
                  class="member-card {selectedMember?.id === member.id ? 'selected' : ''}"
                  on:click={() => handleMemberSelect(member)}
                >
                  <div class="member-info">
                    <div class="member-details">
                      <p class="member-role">{member.publicUserData.identifier}</p>
                      <p class="member-id">Role: {member.role}</p>
                    </div>
                    {#if selectedGuest && selectedMember?.id === member.id}
                      <button 
                        class="assign-button"
                        on:click={() => handleAssign(member)}
                      >
                        Assign
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</main>

<style>
  .admin-container {
    padding: 2rem;
    height: 100vh;
    box-sizing: border-box;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .dashboard-layout {
    display: grid;
    grid-template-columns: 250px 1fr;
    gap: 2rem;
    height: calc(100% - 5rem);
  }

  .section-container {
    background: white;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
  }

  .scrollable-content {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding-right: 0.5rem;
  }

  .scrollable-content::-webkit-scrollbar {
    width: 6px;
  }

  .scrollable-content::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
  }

  .scrollable-content::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 3px;
  }

  .scrollable-content::-webkit-scrollbar-thumb:hover {
    background: #555;
  }

  .guest-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .guest-item {
    padding: 0.75rem;
    background: #f8f9fa;
    border-radius: 4px;
    color: #333;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .guest-item:hover {
    background: #e9ecef;
  }

  .guest-item.selected {
    background: #007bff;
    color: white;
  }

  h1 {
    color: #333;
    margin: 0;
    font-size: 2rem;
  }

  h2 {
    color: #666;
    margin: 0 0 1rem 0;
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .header-buttons {
    display: flex;
    gap: 1rem;
    align-items: center;
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

  .members-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1.5rem;
  }

  .member-card {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .member-card:hover {
    background: #e9ecef;
  }

  .member-card.selected {
    background: #007bff;
    color: white;
  }

  .member-card.selected .member-role,
  .member-card.selected .member-id {
    color: white;
  }

  .member-info {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .member-details {
    flex: 1;
  }

  .member-role {
    margin: 0;
    color: #007bff;
    font-size: 1rem;
    font-weight: 500;
  }

  .member-id {
    margin: 0.25rem 0 0;
    color: #666;
    font-size: 0.9rem;
  }

  .assign-button {
    background: #28a745;
    color: white;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background-color 0.2s;
    white-space: nowrap;
  }

  .assign-button:hover {
    background: #218838;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #666;
  }

  .error {
    text-align: center;
    padding: 2rem;
    color: #dc3545;
    background: #f8d7da;
    border-radius: 4px;
  }
</style> 