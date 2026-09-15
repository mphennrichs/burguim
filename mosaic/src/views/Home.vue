<template>
  <div>
	<h1>Página Inicial</h1>
	<!-- Fetch the resource on click -->
	<button @click="$resources.ping.fetch()">Ping</button>
  </div>
</template>

<script>
export default {
  resources: {
	ping() {
	  return {
		method: "frappe.ping", // Method to call on backend
		onSuccess(d) {
		  alert(d);
		},
	  };
	},
  },
};
</script>
