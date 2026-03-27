const fs = require('fs');
const path = require('path');

const stateFile = path.join(__dirname, 'state.json');

if (!fs.existsSync(stateFile)) {
    console.error(`Error: state.json not found in ${__dirname}`);
    process.exit(1);
}

try {
    const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    let count = 0;

    if (data.combinations && Array.isArray(data.combinations)) {
        data.combinations.forEach(item => {
            if (item.status === 'failed') {
                item.status = 'pending';
                item.attempts = 0;
                item.last_error = null;
                count++;
            }
        });
    }

    if (count > 0) {
        fs.writeFileSync(stateFile, JSON.stringify(data, null, 2));
        console.log(`Successfully reset ${count} items in state.json.`);
    } else {
        console.log('No failed items found in state.json.');
    }
} catch (err) {
    console.error('Error processing state.json:', err);
    process.exit(1);
}
