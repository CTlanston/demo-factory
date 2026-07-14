// Prints its argv (after node + script) as JSON — used to verify shell quoting mechanics.
process.stdout.write(JSON.stringify(process.argv.slice(2)));
